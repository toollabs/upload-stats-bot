var nodemw = require('nodemw'),
	mysql  = require('mysql');


(function(bot) {
// pass configuration object
var client = new bot('.node-bot.config.json'),
	modes = [{
			cat: 'Pages to be updated by UploadStatsBot - top file revisions',
			regexp: /\{\{\s*(?:[Tt]emplate\:)?[Uu]ploadStats\/alive\s*\}\}/,
			template: '{{UploadStats/alive}}',
			queries: [
				'SELECT count(*) AS count FROM image WHERE img_user_text=? ORDER BY img_timestamp DESC;'
			]
		}, {
			cat: 'Pages to be updated by UploadStatsBot - all alive',
			regexp: /\{\{\s*(?:[Tt]emplate\:)?[Uu]ploadStats\/all[ _]alive\s*\}\}/,
			template: '{{UploadStats/all alive}}',
			queries: [
				'SELECT count(*) AS count FROM image WHERE img_user_text=? ORDER BY img_timestamp DESC;',
				'SELECT count(*) AS count FROM oldimage_userindex WHERE oi_user_text=? ORDER BY oi_timestamp DESC;'
			]
		}, {
			cat: 'Pages to be updated by UploadStatsBot - deleted',
			regexp: /\{\{\s*(?:[Tt]emplate\:)?[Uu]ploadStats\/deleted\s*\}\}/,
			template: '{{UploadStats/deleted}}',
			queries: [
				'SELECT count(*) AS count FROM filearchive_userindex WHERE fa_user_text=? ORDER BY fa_timestamp DESC;'
			]
		}, {
			cat: 'Pages to be updated by UploadStatsBot - edits',
			regexp: /\{\{\s*(?:[Tt]emplate\:)?[Uu]ploadStats\/edits\s*\}\}/,
			template: '{{UploadStats/edits}}',
			queries: [
				'SELECT user_editcount AS count FROM user WHERE user_name=?;'
			]
		}],
	currentMode,
	updateBot;

updateBot = {
	version: '0.0.0.2',
	config: {},
	uploadCountCache: {},
	nextMode: function() {
		var updater = this;
		if (!modes.length) return false;

		currentMode = modes.pop();
		updater.uploadCountCache[currentMode.template] = {};
		updater.fetchPages();

		return true;
	},
	launch: function() {
		var updater = this;
		console.log('Hi. This is upload updater bot.');
		updater.logOut(function() {
			updater.establishDBConnection(function() {
				client.logIn(function() {
					// Make the server creating an editToken for our session.
					// If we do that later while processing multiple pages, the sever
					// would create a lot of different tokens due to replecation lag.
					setTimeout(function() {
						client.api.call({
							action: 'tokens'
						}, function(r) {
							setTimeout(function() {
								updater.nextMode();
							}, 1000);
						});
					}, 1000);
				});
			});
		});

		// Kill myself if running too long
		setTimeout(function() {
			updater.logOut();
			process.exit(1);
		}, 90000);
	},
	pages: [],
	pendigPages: 0,
	pendingEdits: 0,
	dbCredentials: {
		pass: '',
		user: ''
	},
	setPassAndUserName: function() {
		// Set the dbCredentials
		console.log('Reading passwords.');
		var fs = require('fs'),
			cred = fs.readFileSync('./replica.my.cnf', {
				encoding: 'utf8'
			}),
			arr = cred.split('\n'),
			l, i, line;
			
		for (i = 0, l = arr.length; i < l; ++i) {
			line = arr[i];
			if (/user\s*\=/.test(line)) {
				this.dbCredentials.user = line.replace(/^\s*user\s*=\s*'(.+)'.*/, '$1');
			} else if (/password\s*\=/.test(line)) {
				this.dbCredentials.pass = line.replace(/^\s*pass(?:word)?\s*=\s*'(.+)'.*/, '$1');
			}
		}
	},
	establishDBConnection: function( cb ) {
		var updater = this;
		this.setPassAndUserName();
		
		var connection = mysql.createConnection({
			host     : 'commonswiki.labsdb',
			database : 'commonswiki_p',
			user     : this.dbCredentials.user,
			password : this.dbCredentials.pass
		});
		connection.connect(function(err) {
			if (err) {
				console.log(err);
			} else {
				console.log('Connected to DB as user ' + updater.dbCredentials.user + '.');
				updater.connection = connection;
				cb();
			}
		});
	},
	getUploadCount: function( username, callback ) {
		var updater = this,
			result = updater.uploadCountCache[currentMode.template][username];
			
		if ( result !== undefined ) return callback( result );


		console.log('Running SQL queries.');

		result = 0;
		var decrementAndContinue = function( count ) {
			pending--;
			result += count;

			if (0 === pending) {
				updater.uploadCountCache[currentMode.template][username] = result;
				callback(result);
			}
		};
		
		
		var i, l,
		pending = 0;
		
		for (var i = 0, l = currentMode.queries.length; i < l; ++i) {
			pending++;
			this.connection.query(currentMode.queries[i], username, function(err, result) {
				if (!err) {
					var result = result[0].count;
				}
				result = result || 0;
				decrementAndContinue( result );
			});
		}
	},
	fetchPages: function() {
		var updater = this;

		client.getPagesInCategory(currentMode.cat, function(data) {
			var i, l, d, pgId;
			
			for (i = 0, l  = data.length; i < l; ++i) {
				d = data[i];
				if ( d.ns === 2 ) {
					updater.pages.push( pgId = data[i].pageid );
					updater.processPage( pgId, data[i].title );
				}
			}
			updater.maybeExit();
		});
	},
	maybeCloseDBConnecton: function() {
		if (this.pendingEdits === 0 && this.pendigPages === 0) {
			console.log('Connection is being closed. Please stay away from the database.');
			this.connection.destroy();
			console.log('Connection closed.');
		}
	},
	maybeExit: function() {
		var updater = this;

		if ( updater.pendigPages !== 0 ) return;
		if ( updater.pendingEdits !== 0 ) return;
		if ( updater.exiting ) return;
		if ( updater.nextMode() ) return;
 
		updater.maybeCloseDBConnecton();
		updater.exiting = true;
		console.info('Bye bye!');
		
		setTimeout(function() {
			updater.logOut(function() {
				process.exit(0);
			});
		}, 1000);
	},
	logOut: function( callback ) {
		client.api.call({
			action: 'logout'
		}, callback || function(){}, 'POST');
	},
	processPage: function(pgId, pgName) {
		var updater = this;

		if (!pgId) return;
		updater.pendigPages++;
		
		client.getArticle(pgId, function(data) {
			updater.pendigPages--;
			console.log('Okay, got page contents for ' + pgName);
			
			if (data.length > 75 || !currentMode.regexp.test(data)) {
				// Do not vandalize pages.
				return updater.maybeExit();
			}
			console.log(pgName + ' has valid content.');
			
			// Fetch upload count of the user
			var username = pgName.replace(/^[^:]+?\:([^\/]+).+/, '$1');

			updater.pendingEdits++;
			updater.getUploadCount( username, function(uploadCount) {
				
				console.log('And ' + username + ' has uploaded ' + uploadCount + ' files that are alive.');
				
				client.edit(pgName, currentMode.template + '<onlyinclude>' + uploadCount + '</onlyinclude>', 'Bot: Updating statistics. New value:' + uploadCount + '. Bot version:' + updater.version, function() {
					updater.pendingEdits--;
					console.log('Editing ' + pgName + ': Okay.');
					updater.maybeExit();
				});
			});

			updater.maybeExit();
		});
		updater.maybeExit();
	}
};

updateBot.launch();
}(nodemw));
