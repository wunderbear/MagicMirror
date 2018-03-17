/* Magic Mirror
 * Node Helper: Calendar - CalendarFetcher
 *
 * By Michael Teeuw http://michaelteeuw.nl
 * MIT Licensed.
 */

var request = require("request");
var ical = require("./vendor/ical.js");
var moment = require("moment");

var CalendarFetcher = function(url, reloadInterval, excludedEvents, maximumEntries, maximumNumberOfDays, auth) {
	var self = this;

	var reloadTimer = null;
	var events = [];

	var failedRetrievals = 0;

	var fetchFailedCallback = function() {};
	var eventsReceivedCallback = function() {};

	/* fetchCalendar()
	 * Initiates calendar fetch.
	 */
	var fetchCalendar = function() {

		// We've started working, so disable next execution schedule for now
		clearTimeout(reloadTimer);
		reloadTimer = null;

		// Build a nice HTTP User-Agent string
		nodeVersion = Number(process.version.match(/^v(\d+\.\d+)/)[1]);
		var opts = {
			headers: {
				"User-Agent": "Mozilla/5.0 (Node.js "+ nodeVersion + ") MagicMirror/"  + global.version +  " (https://github.com/MichMich/MagicMirror/)"
			}
		};

		// Arrange HTTP authorization information
		if (auth) {
			if(auth.method === "bearer"){
				opts.auth = {
					bearer: auth.pass
				}
			} else {
				opts.auth = {
					user: auth.user,
					pass: auth.pass
				};

				if(auth.method === "digest"){
					opts.auth.sendImmediately = false;
				}else{
					opts.auth.sendImmediately = true;
				}
			}
		}

		// Invoke the calendar URL with HTTP options from above
		request.get(url, opts, retrieveCallback);
	};

	// Invoked when HTTP GET to calendar url returns content
	var retrieveCallback = function(err, response, body) {
		if(!response || response.statusCode != 200) {
			console.log("Unable to retrieve data from " + url + 
						". HTTP status code " + response.statusCode);
						
			// we will retry again several times after 10s, then wait for a longer time
			if(failedRetrievals < 3) {
				failedRetrievals++;				
				scheduleTimer(10000);
			} else {
				failedRetrievals = 0
				scheduleTimer(reloadInterval);
			}
			return;
		}

		// successfully retrieved calendar
		failedRetrievals = 0
		
		var allEvents = parseCalendar(body);
		if(allEvents.length > 0) {
			// filter & sort events, limit number to maxEntries
			var filteredEvents = filterEvents(allEvents);
			filteredEvents.sort(function(a, b) {
				return a.startDate - b.startDate;
			});
			filteredEvents = filteredEvents.slice(0, maximumEntries);
			console.log("Found " + allEvents.length +
                        " events, after filtering and time slicing " + filteredEvents.length +
                        " remain from calendar " + url);

			// translate to event data structure used by magic mirror modules
			events = [];
			filteredEvents.forEach(event => {
				events.push({
					title: event.summary,
					startDate: moment(event.startDate.toJSDate()).format("x"),
					endDate: moment(event.endDate.toJSDate()).format("x"),
					fullDayEvent: event.fullDayEvent,
					class: event.class,
					location: event.location,
					geo: event.geo,
					description: event.description
				});
			});

			// tell other modules
			self.broadcastEvents();
		}
		else {
			console.log("No events retrieved from " + url);
		}

		// ... and play it again, Sam
		scheduleTimer(reloadInterval);
	};

	/* parseCalendar(icalData)
	 * Uses ical to parse retrieved data as iCal calendar
	 */
	var parseCalendar = function(icalData)
	{
		if(icalData === null) return;

		var jcalData = ical.parse(icalData);
		var comp = new ICAL.Component(jcalData);
		var vevents = comp.getAllSubcomponents('vevent');

		return vevents;
	}

	/* filterEvents(vevents)
	 * Limits an array of vevents to elemant that matter w.r.t.
	 * caller settings
	 */
	var filterEvents = function(vevents)
	{
		var debug = true;

		var now = moment();
		var future = moment().startOf("day").add(maximumNumberOfDays, "days").subtract(1,"seconds"); // Subtract 1 second so that events that start on the middle of the night will not repeat.
		var goodEvents = [];

		for (const vevent of vevents) {
			var event = new ICAL.Event(vevent);
			var startDate = moment(event.startDate.toJSDate());
			var endDate = moment(event.endDate.toJSDate());

			if(endDate.isBefore(now))     // we're not interested in past events
			{
				if(debug) console.log("Skipped past event" + 
							          ", title: " + event.summary + 
									  ", begin: " + startDate.toISOString() + 
									  ", end: " + endDate.toISOString()); 
				continue;      
			}

			if(startDate.isAfter(future)) // we're not interested in far out events
			{ 
				if(debug) console.log("Skipped far future event" + 
							          ", title: " + event.summary + 
									  ", begin: " + startDate.toISOString() + 
									  ", end: " + endDate.toISOString()); 				
				continue;  
			}

			goodEvents.push(event);
		}

		return goodEvents;
	}

	/* scheduleTimer()
	 * Schedule the timer for the next update.
	 */
	var scheduleTimer = function(interval) {
		//console.log('Schedule update timer.');
		clearTimeout(reloadTimer);
		reloadTimer = setTimeout(function() {
			fetchCalendar();
		}, interval);
	};

	/* isFullDayEvent(event)
	 * Checks if an event is a fullday event.
	 *
	 * argument event obejct - The event object to check.
	 *
	 * return bool - The event is a fullday event.
	 */
	var isFullDayEvent = function(event) {
		if (event.start.length === 8) {
			return true;
		}

		var start = event.start || 0;
		var startDate = new Date(start);
		var end = event.end || 0;

		if (end - start === 24 * 60 * 60 * 1000 && startDate.getHours() === 0 && startDate.getMinutes() === 0) {
			// Is 24 hours, and starts on the middle of the night.
			return true;
		}

		return false;
	};

	/* public methods */

	/* startFetch()
	 * Initiate fetchCalendar();
	 */
	this.startFetch = function() {
		fetchCalendar();
	};

	/* broadcastItems()
	 * Broadcast the existing events.
	 */
	this.broadcastEvents = function() {
		//console.log('Broadcasting ' + events.length + ' events.');
		eventsReceivedCallback(self);
	};

	/* onReceive(callback)
	 * Sets the on success callback
	 *
	 * argument callback function - The on success callback.
	 */
	this.onReceive = function(callback) {
		eventsReceivedCallback = callback;
	};

	/* onError(callback)
	 * Sets the on error callback
	 *
	 * argument callback function - The on error callback.
	 */
	this.onError = function(callback) {
		fetchFailedCallback = callback;
	};

	/* url()
	 * Returns the url of this fetcher.
	 *
	 * return string - The url of this fetcher.
	 */
	this.url = function() {
		return url;
	};

	/* events()
	 * Returns current available events for this fetcher.
	 *
	 * return array - The current available events for this fetcher.
	 */
	this.events = function() {
		return events;
	};

};


module.exports = CalendarFetcher;
