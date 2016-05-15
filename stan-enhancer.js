
//
// Poller
//

var Poller = {
	time: 0,
	loop_ms: 200,
	timeout_ms: 2000,
	items: [],

	init: function(loop_ms, timeout_ms) {
		this.loop_ms = loop_ms;
		this.timeout_ms = timeout_ms;

		var _this = this;
		var timeoutLoop = function() {
			setTimeout(function(){
				_this.loop();
				timeoutLoop();
			},
			_this.loop_ms);		
		};
		timeoutLoop();
	},

	loop: function() {
		var _this = this;
		this.time = Date.now();
		this.items = this.items.filter(function(item){
			return _this.checkItem(item);
		});
	},

	checkItem(item) {
		if(item.condition()) {
			if(typeof item.change == "function") {
				item.change();
			}

			if(typeof item.done != "undefined") {
				if(typeof item.done == "function") {
					item.done();
				}
				return false;
			}

		} else if(typeof item.timeout != "undefined" && item.added + this.timeout_ms < this.time) {
			if(typeof item.timeout == "function") {
				item.timeout();
			}
			return false;
		}
		return true;
	},

	add: function(item) {
		item.added = Date.now();
		this.items.push(item);
	}
};

//
// OMDB Ratings
//

var OMDBRatings = {
	fetch(info, success, failure) {
		var _this = this;
		var type = info.programType=="series" ? "series" : "movie";

		$.getJSON( "https://www.omdbapi.com/?t="+encodeURIComponent(info.title)+"&type="+type+"&plot=short&tomatoes=true&r=json", function(data) {
			if(data.Response != "False") {
				success(data);
			} else {
				failure();
			}
		});
	}
};

//
// Render
//

var Render = {
	program: function(elem, programData) {
		elem.html("");

		// add imdb
		if(programData.imdbRating) {
			var imdbURL = "http://www.imdb.com/title/"+programData.imdbID+"/";
			elem.append('<a href="'+imdbURL+'" target="_blank" class="stan-enhance-button stan-enhance-imdb" title="IMDB rating"><img class="stan-enhance-icon" src="'+chrome.extension.getURL("imdb-star.png")+'" />'+programData.imdbRating+'</a>');
		}

		// add tomatoes
		if(programData.tomatoMeter && programData.tomatoMeter != "N/A") {
			elem.append('<a href="'+programData.tomatoURL+'" target="_blank" class="stan-enhance-button stan-enhance-rt" title="Rotten Tomatoes rating: '+programData.tomatoImage+'"><img class="stan-enhance-icon" src="'+chrome.extension.getURL("rt-"+programData.tomatoImage+".png")+'" />'+programData.tomatoMeter+'</a>');
		}

		// add link to trailer
		var youtubeKeywords = programData.title.toLowerCase();
		if(programData.releaseYear) {
			youtubeKeywords += " "+programData.releaseYear;
		}
		youtubeKeywords += " official trailer";
		elem.append('<a href="https://www.youtube.com/results?search_query='+encodeURIComponent(youtubeKeywords)+'" target="_blank" class="stan-enhance-button stan-enhance-trailer" title="Search for trailer on Youtube"><img class="stan-enhance-icon" src="'+chrome.extension.getURL("yt-icon.png")+'" /></a>');
	},

	programLoading: function(elem) {
		elem.html('<div class="stan-enhance-loading"><div class="stan-enhance-dot stan-enhance-dot-1"></div><div class="stan-enhance-dot stan-enhance-dot-2"></div><div class="stan-enhance-dot stan-enhance-dot-3"></div><div class="stan-enhance-dot stan-enhance-dot-4"></div></div>');
	}
};

//
// Program details
//

var ProgramDetails = {
	programs: {},
	
	fetch: function(id, success) {
		if(this.programs.hasOwnProperty(id)) {
			if(this.programs[id] == "fetching") {
				return;
			}
			success(this.programs[id]);
			return;
		}

		this.programs[id] = "fetching";

		var _this = this;
		this.fetchStanDetails(id, function(data) {
			var program = data;

			// fix when stan says releaseYear is 0
			// remove releaseYear if this is a series
			if(program.releaseYear === 0 || program.programType == "series") {
				program.releaseYear = "";
			}

			var OMDBsuccess = function(ratings) {
				program.imdbRating = ratings.imdbRating;
				program.imdbID = ratings.imdbID;
				program.tomatoMeter = ratings.tomatoMeter;
				program.tomatoImage = ratings.tomatoImage;
				program.tomatoURL = ratings.tomatoURL;

				if(program.programType != "series") {
					program.releaseYear = ratings.Year; // this year is correct more often than Stan						
				}

				_this.programs[id] = program;
				success(program);
			};

			var OMDBfailure = function() {
				success(program);
			};

			OMDBRatings.fetch({
				title: data.title,
				programType: program.programType,
				releaseYear: data.releaseYear

			}, OMDBsuccess, OMDBfailure);
		});
	},

	getProgramIdFromURL: function(url) {
		var match = url.match(/programs\/([0-9]+)/i);
		if(match == null || match.length < 2) {
			return null;
		}
		return match[1];
	},

	fetchStanDetails: function(id, success) {
		$.getJSON( "https://v12.cat.api.stan.com.au/programs/"+id+".json", function(data) {
			if(data.seriesUrl) {
				$.getJSON(data.seriesUrl, function(data) {
					success(data);
				});
			} else {
				success(data);
			}
		});
	}
};

//
// Pop
//

var Pop = {
	enhance: function(li) {
		var _this = this;

		if(li.data('stan-enhanced')) {
			return;
		}
		li.data('stan-enhanced',true);


		Poller.add({
			condition: function() {
				return _this.isReady(li);
			},
			done: function() {
				_this.update(li);
			},
			timeout: function() {
				_this.reset(li);
			}
		});
	},

	isReady: function(li) {
		var pop = li.children().children('.pop');
		return pop.length>0 && pop.find('.pop__attributes').length>0;
	},

	update: function(li) {
		var _this = this;
		var id = this.getProgramId(li);

		_this.clear(li);
		var popFooter = $('<div class="stan-enhance-pop-footer">');
		li.find('.pop__footer').append(popFooter);
		Render.programLoading(popFooter);

		ProgramDetails.fetch(id, function(program) {
			Render.program(popFooter, program);
		});
	},

	clear: function(li) {
		li.find('.stan-enhance-pop-footer').remove();
	},

	reset: function(li) {
		this.clear(li);
		li.data('stan-enhanced',false);
	},

	getProgramId(li) {
		return ProgramDetails.getProgramIdFromURL(li.find('a.programs__panel').attr('href'));
	}
};

//
// Program page
//

var ProgramPage = {
	update: function(id) {
		var programElem = $('body').find('.program .program__details');
		var _this = this;

		_this.clear(programElem);
		var container = $('<div class="stan-enhance-program-page"></div>');
		programElem.append(container);

		Render.programLoading(container);

		ProgramDetails.fetch(id, function(program) {
			Render.program(container, program);
		});
	},

	isReady: function() {
		return $('body').find('.program .program__details').length > 0;
	},

	clear: function(programElem) {
		programElem.find('.stan-enhance-program-page').remove();
	}
};

//
// Ready
//

$(document).ready(function(){

	Poller.init(250, 2000);

	$('body').mouseover(function(event){
		var li = $(event.target).closest('li.programs__item');
		if(li.length==0) {
			return;
		}
		Pop.enhance(li);
	});

	Poller.add({
		url: "",
		isUpdated: false,
		condition: function() {
			var isNewURL = this.url != window.location.href;
			if(isNewURL) {
				this.url = window.location.href;
				this.isUpdated = false;
			}
			return !this.isUpdated && ProgramPage.isReady();
		},
		change: function() {
			var id = ProgramDetails.getProgramIdFromURL(this.url);
			if(id) {
				ProgramPage.update(id);
			}
			this.isUpdated = true;
		}
	});
});