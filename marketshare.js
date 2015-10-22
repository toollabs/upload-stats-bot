var nodemw = require('nodemw'),
	mysql  = require('mysql');


(function(bot) {
// pass configuration object
var client = new bot('.node-bot.config.json'),
	tools = [{
		name: 'bigChunkedUpload dot JS',
		signature: '%bigChunkedUpload.js%'
	}, {
		name: 'Upload Wizard (WMF)',
		signature: '%with UploadWizard%'
	}, {
		name: 'VicuñaUploader',
		signature: '%Vicu__aUploader%'
	}, {
		name: 'Videoconvert upload from toollabs',
		signature: '_ideoconvert % toollabs'
	}, {
		name: 'GLAM wiki toolset',
		signature: '%GWToolset%'
	}],
	updateBot;

updateBot = {
	version: '0.0.0.1',
	config: {
		query: 'SELECT count(*) AS count FROM image '
			+ 'WHERE `img_size` > 209715200 '
			+ 'AND `img_timestamp` > 20150301000000 '
			+ 'AND `img_description` LIKE ? '
			+ 'ORDER BY `img_timestamp` DESC;',
		totalQuery: 'SELECT count(*) AS count FROM image '
			+ 'WHERE `img_size` > 209715200 '
			+ 'AND `img_timestamp` > 20150301000000 '
			+ 'ORDER BY `img_timestamp` DESC;',
	},
	nextTool: function() {
		var updater = this;
		if (!tools.length) return false;

		updater.updateTotal();
		updater.update( tools.pop() );

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
								updater.nextTool();
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
		}, 360000);
	},
	pages: [],
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
	updatePageWith: function( value, toolName, callback ) {
		var updater = this;
		console.log( 'Updating page for ' + toolName + ': ' + value );

		client.edit('User:Rillke/bigChunkedUpload.js/share/' + toolName, '<onlyinclude>' + value + '</onlyinclude>', 'Bot: Updating statistics. New value:' + value + '. Bot version:' + updater.version, callback);
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

		if ( updater.pendingEdits !== 0 ) return;
		if ( updater.exiting ) return;
		if ( updater.nextTool() ) return;
 
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
	getShare: function( toolSignature, callback ) {
		console.log('Running SQL query.');
		if ( toolSignature ) {
			this.connection.query(this.config.query, toolSignature, function(err, result) {
				var result;

				if (!err) {
					result = result[0].count;
				}
				result = result || 0;
				callback( result );
			});
		} else {
			this.connection.query(this.config.totalQuery, function(err, result) {
				var result;

				if (!err) {
					result = result[0].count;
				}
				result = result || 0;
				callback( result );
			});
		}
	},
	update: function( tool ) {
		var updater = this;

		updater.pendingEdits++;
		updater.getShare( tool.signature, function( value ) {
			updater.updatePageWith( value, tool.name, function() {
				updater.pendingEdits--;
				console.log( 'Editing ' + tool.name + ': Okay.' );
				updater.maybeExit();
			} );
		} );
	},
	updateTotal: function() {
		var updater = this;

		updater.pendingEdits++;
		updater.getShare( '', function( value ) {
			updater.updatePageWith( value, 'total', function() {
				updater.pendingEdits--;
				console.log( 'Editing total: Okay.' );
				updater.maybeExit();
			} );
		} );
	}
};

updateBot.launch();
}(nodemw));
