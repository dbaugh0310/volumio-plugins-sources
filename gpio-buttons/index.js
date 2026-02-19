'use strict';

var libQ = require('kew');
var fs = require('fs-extra');
var Gpio = require('onoff').Gpio;
var io = require('socket.io-client');
var socket = io.connect('http://localhost:3000');
var actions = ["playPause", "volumeUp", "volumeDown", "previous", "next", "shutdown"];

module.exports = GPIOButtons;

function GPIOButtons(context) {
	var self = this;
	self.context=context;
	self.commandRouter = self.context.coreCommand;
	self.logger = self.context.logger;
	self.triggers = [];
}


GPIOButtons.prototype.onVolumioStart = function () {
	var self = this;

	var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

	self.logger.info("GPIO-Buttons initialized");
	
	return libQ.resolve();	
};


GPIOButtons.prototype.getConfigurationFiles = function()
{
	return ['config.json'];
};


GPIOButtons.prototype.onStart = function () {
	var self = this;
	var defer=libQ.defer();

	// Create a container for our LED objects if it doesn't exist
    self.leds = {};

	// ... (existing action loop)
    actions.forEach(function(action) {
        var ledPin = self.config.get(action + '.led');
        var isEnabled = self.config.get(action + '.enabled');

        if (isEnabled && ledPin !== undefined) {
            // Initialize pin as output, starting LOW (off)
            self.leds[action] = new Gpio(ledPin, 'out');
        }
    });

	self.createTriggers()
		.then (function (result) {
			self.logger.info("GPIO-Buttons started");
			defer.resolve();
		});
	
    return defer.promise;
};


GPIOButtons.prototype.onStop = function () {
	var self = this;
	var defer=libQ.defer();

	self.clearTriggers()
		.then (function (result) {
			self.logger.info("GPIO-Buttons stopped");
			defer.resolve();
		});

	// Unexport all LEDs
    Object.keys(self.leds).forEach(function(key) {
        self.leds[key].writeSync(0); // Turn off before releasing
        self.leds[key].unexport();
    });
	
    return defer.promise;
};


GPIOButtons.prototype.onRestart = function () {
	var self = this;
};

GPIOButtons.prototype.onInstall = function () {
	var self = this;
};

GPIOButtons.prototype.onUninstall = function () {
	var self = this;
};

GPIOButtons.prototype.getConf = function (varName) {
	var self = this;
};

GPIOButtons.prototype.setConf = function(varName, varValue) {
	var self = this;
};

GPIOButtons.prototype.getAdditionalConf = function (type, controller, data) {
	var self = this;
};

GPIOButtons.prototype.setAdditionalConf = function () {
	var self = this;
};

GPIOButtons.prototype.setUIConfig = function (data) {
	var self = this;
};


GPIOButtons.prototype.getUIConfig = function () {
	var defer = libQ.defer();
	var self = this;

	self.logger.info('GPIO-Buttons: Getting UI config');

	//Just for now..
	var lang_code = 'en';

	//var lang_code = this.commandRouter.sharedVars.get('language_code');

        self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
                __dirname+'/i18n/strings_en.json',
                __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {

			var i = 0;
			actions.forEach(function(action, index, array) {
 				
 				// Strings for config
				var c1 = action.concat('.enabled');
				var c2 = action.concat('.pin');
				var c3 = action.concat('.led');
				
			// 2. Map to uiconf. 
				// We multiply 'i' by 3 because there are now 3 elements per button group.
				
				// Element 0: Enabled Toggle
				uiconf.sections[0].content[3*i].value = self.config.get(c1);
				
				// Element 1: Pin Number
				uiconf.sections[0].content[3*i+1].value.value = self.config.get(c2);
				uiconf.sections[0].content[3*i+1].value.label = self.config.get(c2).toString();

				// Element 2: LED Number (The new part)
				uiconf.sections[0].content[3*i+2].value.value = self.config.get(c3);
				uiconf.sections[0].content[3*i+2].value.label = self.config.get(c3).toString();
			
			});

            defer.resolve(uiconf);
		})
        .fail(function()
        {
            defer.reject(new Error());
        });

        return defer.promise;
};


GPIOButtons.prototype.saveConfig = function(data)
{
	var self = this;

	actions.forEach(function(action, index, array) {
 		// Strings for data fields
		var s1 = action.concat('Enabled');
		var s2 = action.concat('Pin');
		var s3 = action.concat('LED');

		// Strings for config
		var c1 = action.concat('.enabled');
		var c2 = action.concat('.pin');
		var c3 = action.concat('.value');
		var c4 = action.concat('.led');

		self.config.set(c1, data[s1]);
		self.config.set(c2, data[s2]['value']);
		self.config.set(c3, 0);
		self.config.set(c2, data[s3]['value']);
	});

	self.clearTriggers()
		.then(self.createTriggers());

	self.commandRouter.pushToastMessage('success',"GPIO-Buttons", "Configuration saved");
};


GPIOButtons.prototype.createTriggers = function() {
	var self = this;

	self.logger.info('GPIO-Buttons: Reading config and creating triggers...');

	actions.forEach(function(action, index, array) {
		var c1 = action.concat('.enabled');
		var c2 = action.concat('.pin');

		var enabled = self.config.get(c1);
		var pin = self.config.get(c2);

		if(enabled === true){
			self.logger.info('GPIO-Buttons: '+ action + ' on pin ' + pin);
			var j = new Gpio(pin,'in','both');
			j.watch(self.listener.bind(self,action));
			self.triggers.push(j);
		}
	});
		
	return libQ.resolve();
};


GPIOButtons.prototype.clearTriggers = function () {
	var self = this;
	
	self.triggers.forEach(function(trigger, index, array) {
  		self.logger.info("GPIO-Buttons: Destroying trigger " + index);

		trigger.unwatchAll();
		trigger.unexport();		
	});
	
	self.triggers = [];

	return libQ.resolve();	
};


GPIOButtons.prototype.listener = function(action,err,value){
	var self = this;

	var c3 = action.concat('.value');
	var lastvalue = self.config.get(c3);

	// IF change AND high (or low?)
	if(value !== lastvalue && value === 1){

		// 1. Turn OFF all LEDs first
        Object.keys(self.leds).forEach(function(key) {
            self.leds[key].writeSync(0);
        });

		// 2. Turn ON the LED for the button just pressed
        if (self.leds[action]) {
            self.leds[action].writeSync(1);
        }

		//do thing
		self[action]();
	}
	// remember value
	self.config.set(c3,value);
};

GPIOButtons.prototype.button1 = function() {
  this.logger.info('GPIO-Buttons: button1 pressed');
  socket.emit('playPlaylist',{'name':'key1'})
};

GPIOButtons.prototype.button2 = function() {
  this.logger.info('GPIO-Buttons: button2 pressed');
  socket.emit('playPlaylist',{'name':'key2'})
};

GPIOButtons.prototype.button3 = function() {
  this.logger.info('GPIO-Buttons: button3 pressed');
  socket.emit('playPlaylist',{'name':'key3'})
};

GPIOButtons.prototype.button4 = function() {
  this.logger.info('GPIO-Buttons: button4 pressed');
  socket.emit('playPlaylist',{'name':'key4'})
};

GPIOButtons.prototype.button5 = function() {
  this.logger.info('GPIO-Buttons: button5 pressed');
  socket.emit('playPlaylist',{'name':'key5'})
};

GPIOButtons.prototype.shutdown = function() {
  // this.logger.info('GPIO-Buttons: shutdown button pressed\n');
  this.commandRouter.shutdown();
};
