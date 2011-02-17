var http = require('http');
var net = require('net');
var c = require('./cli.js');
var EventEmitter = require('events').EventEmitter;

/**
 * @fileoverview Grabs dAmn Authtoken
 * @author nuckchorris0.deviantart.com (Peter Lejeck)
 */

/**
 * The info on the dAmn library
 * @type {object}
 * @const
 */
const info = {
	agent:		'dAmnJS/0.3',
	name:		'dAmnJS',
	version:	0.3,
};

/**
 * The address and port and other info on the dAmn chat server and the login server.
 * @type {object}
 * @const
 */
const server = {
	chat: {
		host: 'chat.deviantart.com',
		version: '0.3',
		port: 3900
	},
	login: {
		transport: 'https://',
		host: 'www.deviantart.com',
		file: '/users/login',
		port: 443
	}
};

 /**
 * Class for connecting, providing events and other functions for dAmn.
 * @param {string} user The username to log in with.
 * @param {string} path The password to log in with.
 * @param {string} opt_auth A saved authtoken to try using before resorting to actual login.
 * @class
 */
var dAmnJS = function ( user, pass ) {
	if ( !user || !pass ) return false;
	
	this.username = user;
	this.password = pass;
	this.authtoken = '';
	
	this.events = new EventEmitter();
	this.chats = {};
	this.disconnects = 0;
	this.socket;
	this.buffer = '';
	
	this.genEnvir = function ( forWhat ) {
		var obj = {};
		switch( forWhat ) {
			default:
				obj = this;
		}
		return obj;
	};
	
	/** Currying for the callback */
	this.genCB = function( cb, e ) {
		var event = e;
		var callback = cb;
		var envir = this.genEnvir('callback');
		var args = Array.prototype.slice.call(arguments,2);
		if ( this.socket ) args.unshift( this.socket );
		args.unshift( event );
		return function(){
			callback.apply( envir, args );
			this.events.emit( 'sys_' + event, args );
		}.bind(this);
	}.bind(this);

	this.parsePacket = function (rpkt, depth) {
		rpkt = rpkt.toString();
		depth = depth || 0;
		var i;
		var ppkt = {
			cmd: null,
			param: null,
			args: {},
			body: null,
			sub: [],
			depth: depth,
			raw: rpkt
		};
		var parts = rpkt.split("\n\n");
		var head = parts.shift().split('\n');
		var cmd  = head.shift().split(' ');
		ppkt.cmd = cmd.shift();
		ppkt.param = cmd.join(' ');
		
		for (i in head) {
			if (head.hasOwnProperty(i)) {
				var val = head[i].split('=');
				ppkt.args[ val.shift() ] = val.join('=');
			}
		}
		ppkt.body = parts.join('\n\n') || null;
		if (parts.length >= 1) {
			i = parts.length - 1;
			if (i === 1) {
				ppkt.sub.push( arguments.callee(ppkt.body, depth + 1) );
			} else {
				for (i; i >= 0; i--) { ppkt.sub.push( arguments.callee(parts[i], depth + 1) ); }
			}
		}
		
		return ppkt;
	}

	/**
	 * Logs into deviantART, grabs the cookie, and extracts the authtoken.
	 * Doesn't return the authtoken or cookie; you must bind the sys_authtoken event for that.
	 */
	this.login = function ( cb ) {
		var cb = cb || function(){};
		var postdata, headers = {};
		postdata  = 'ref=' + encodeURI( server.login.transport + server.login.host + server.login.file );
		postdata += '&username=' + encodeURI( this.username );
		postdata += '&password=' + encodeURI( this.password );
		postdata += '&reusetoken=1';
		
		headers['Host']				= server.login.host;
		headers['User-Agent']		= info.agent;
		headers['Accept']			= "text/html";
		headers['Cookie']			= "skipintro=1";
		headers['Content-Type']		= "application/x-www-form-urlencoded";
		headers['Content-Length']	= postdata.length;
		
		var login = http.createClient( server.login.port, server.login.host, true );
		var request = login.request( 'POST', server.login.file, headers );
		request.write( postdata );
		request.end();
		c.info( 'Getting Cookie...' );
		request.on( 'response', function( response ){
			var headers = {};
			headers['Host']				= 'chat.deviantart.com';
			headers['User-Agent']		= info.agent;
			headers['Accept']			= "text/html";
			headers['Cookie']			= response.headers["set-cookie"].join(';');
			
			var getAuth = http.createClient( 80, 'chat.deviantart.com' );
			var req = getAuth.request( 'GET', '/chat/botdom', headers );
			req.end();
			req.on( 'response', function( resp ){
				c.info( 'Loading chat page...' );
				
				resp.on('data', function (chunk) {
					if ( chunk.toString().indexOf( 'dAmn_Login(' ) !== -1 ) {
						this.authtoken = /dAmn_Login\(\s*\".*\",\s*\"([a-f0-9]{32})\"\s*\)/.exec( chunk.toString() )[1];
						this.genCB( cb, 'success', this.authtoken, true )();
					}
				}.bind(this) );
			}.bind(this) );
		}.bind(this) );
	};

	this.chat = {};
	
	/**
	 * Connects to the dAmnServer using the authtoken stored into the dAmnJS object by getCookie.
	 */
	this.chat.connect = function ( cb ) {
		var cb = cb || function(){};
		this.socket = net.createConnection( server.chat.port, server.chat.host );
		this.socket.setEncoding( 'utf8' );
		this.socket.on( 'connect', function(){
			data  = 'dAmnClient ' + server.chat.version + "\n";
			data += 'agent=' + info.agent + "\n";
			data += 'creator=nuckchorris0/peter.lejeck@gmail.com'+"\n\0";
			this.socket.write( data );
			this.genCB( cb, 'connected' )();
		}.bind(this) );
//		this.socket.on( 'connect', this.genCB( cb, 'connected' ) );
//		this.socket.on( 'error', this.genCB( cb, 'error' ) );
//		this.socket.on( 'end', this.genCB( cb, 'end' ) );
//		this.socket.on( 'close', this.genCB( cb, 'close' ) );
		
		// Handle socket recieving.
		this.socket.on( 'data', function( data ) {
			if ( data == "ping\n\0" ) {
				this.socket.write( "pong\n\0" );
			}
			if( data !== false && data !== '' ) {
				this.buffer += data;
				var parts = this.buffer.split( "\0" );
				this.buffer = ( parts[parts.length - 1] !== '' ) ? parts.pop() : '';
			} else {
				var parts = ["disconnect\ne=socket closed\n\n"];
			}
			for( var packet in parts ) {
				if ( parts[ packet ] !== '' ) {
					var p = this.parsePacket( parts[ packet ] );
					this.events.emit( p.cmd, p );
				}
			}
		}.bind(this) );
	}.bind(this);
	/**
	 * Sends a login packet to the dAmnServer with the dAmnJS object's stored authtoken.
	 */
	this.chat.login = function ( cb ) {
		var cb = cb || function(){};
		this.socket.write( 'login ' + this.username + '\npk=' + this.authtoken + "\n\0" );
		this.events.once( 'login', function( pkt ) {
			if ( pkt.args.e == 'ok' ) {
				this.socket.write( 'disconnect\n\0' );
				c.info( '[[@fg;yellow]]Authtoken Works![[@fg;dkgreen]]' );
			} else {
				this.socket.write( 'disconnect\n\0' );
				c.error( 'Authtoken Fails!' );
			}
		}.bind(this) );
	}.bind(this);

	return this;
};
c.clr().move(1,1);







var dAmn = new dAmnJS( 'username', 'password' );







c.info( 'Logging in...' );
dAmn.login(function( event, authtoken ){
	c.info( '[[@fg;purple]]Authtoken: [[@fg;magenta]]' + authtoken + '[[@fg;dkgreen]]' );
	c.info( 'Connecting to dAmnServer...' );
	this.chat.connect(function( event, socket ){
		c.info( 'Logging in to dAmnServer to check authtoken...' );
		this.chat.login();
	});
});