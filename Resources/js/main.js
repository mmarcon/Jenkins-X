/**
 * @author Massimiliano Marcon
 */


(function($){
    var J,
    _statusBar,
    _settings,
    _tray,
    _TrayMenu,
    _initDOMStuff,
    _attachEvents,
    _initTrayIcon,
    _setBadge,
    _setBadgeIcon,
    _showNotification, _n,
    _updateStatusBar,
    _cleanStatusBar,
    _loadJenkinsData,
    _jobStatus = {},
    _determineGlobalStatus,
    _currentStatus,
    _schedulerReferences = {},
    that,
    
    JK_XML_API_URL = '/api/xml',
    JK_STATUS = {
        success: 'SUCCESS',
        failure: 'FAILURE',
        inactive: 'INACTIVE'
    },
    JK_SETTINGS,
    JK_MIN_POLLING_TIME = 10000,
    
    JenkinsX = function(){
        //Init
        that = this;
        _initDOMStuff();
        JK_SETTINGS = that.loadSettings();
        _initTrayIcon();
        //Get/parse/show data
        this.scheduleJobMonitoring();
    };
    
    _TrayMenu = [
        {label: 'Quit JenkinsX', callback: function(){
            Titanium.App.exit();
        }}
    ];
    
    J = JenkinsX.prototype;
    
    J.saveSettings = function(settings, success, error){
        if (!settings.url || !settings.jobs || settings.jobs.length === 0) {
            if (typeof error === 'function') {
                error('Missing parameter in settings');
            }
            return;
        }
        else {
            JK_SETTINGS = settings;
            //Save settings permanently
            Titanium.App.Properties.setString("url", settings.url);
            Titanium.App.Properties.setList("jobs", settings.jobs);
            Titanium.App.Properties.setInt("pollingtime", settings.pollingTime);
            _n('Settings saved!');
            this.rescheduleJobMonitoring();
        }
    };
    
    J.loadSettings = function(success){
        var settings = {};
        settings.url = Titanium.App.Properties.getString('url', 'default.host.com');
        settings.jobs = Titanium.App.Properties.getList('jobs', 'Jenkink_Job_Name');
        settings.pollingTime = Titanium.App.Properties.getInt('pollingtime', 10000);
        return settings;
    };
    
    J.exportSettings = function(path, success){
    	Titanium.App.Properties.saveTo(path);
    };
    
    J.scheduleJobMonitoring = function(){
    	var poller = function(job){
        	_schedulerReferences [job] = setTimeout(_loadJenkinsData, JK_SETTINGS.pollingTime || JK_MIN_POLLING_TIME, job, null, function(){poller(job);});
        	
        	/*
            setTimeout(function(){
                _updateStatusBar('Polling Jenkins...');
                _loadJenkinsData(job, null, function(){
                	poller(job);
                });
            }, JK_SETTINGS.pollingTime || JK_MIN_POLLING_TIME);*/
        };
        JK_SETTINGS.jobs.forEach(function(job){
        	$('.monitor').append($('<span>').attr('id', job).addClass('inactive').text(job.replace(/_/g, ' ')));
        	_jobStatus [job] = JK_STATUS.inactive;
        	poller(job);
        });
        _determineGlobalStatus();
    };
    
    J.descheduleJobMonitoring = function(){
    	var job;
    	$('.monitor').empty();
    	for (job in _schedulerReferences) {
    		if (_schedulerReferences.hasOwnProperty(job) && _schedulerReferences[job]) {
    			clearTimeout(_schedulerReferences[job]);
    		}
    	}
    };
    
    J.rescheduleJobMonitoring = function(){
    	this.descheduleJobMonitoring();
    	this.scheduleJobMonitoring();
    };
    
    _initDOMStuff = function(){
        _statusBar = $('.status-bar');
        _settings = $('.jenkins-x-settings');
        
        _attachEvents();
    };
    
    _attachEvents = function(){
        $('#settings-submit').on('click', function(e){
            var settings = {}, pollingTime;
            
            pollingTime = parseInt($('#polling-time').val(), 10);
            pollingTime = Math.min (Math.max(pollingTime, 1), 60); //between 1 and 60 seconds
            $('#polling-time').val(pollingTime);
            
            settings.url = $('#jenkinsUrl').val();
            settings.jobs = $('#jobs').val().replace(/\s+/g, '').split(',');
            settings.pollingTime = pollingTime * 1000;
            that.saveSettings(settings);
            return false;
        });
        
        $('#settings-export').on('click', function(e){
            Titanium.UI.openSaveAsDialog(function(file){ //This method is not in the Object it is supposed to be in!
            	if (file && file[0]) {
            		that.exportSettings(file[0]);
            	}
            }, {
            	title: "Save document...",
		        types: ['properties'],
		        defaultFile: "jenkins-x.properties",
		        multiple: false,
		        path: Titanium.Filesystem.getDesktopDirectory().toString()
            });
            return false;
        });

        $('a[data-toggle="tab"]').on('shown', function(e){
            if (e.target.hash === '#settings' && JK_SETTINGS.url) {
                $('#jenkinsUrl').val(JK_SETTINGS.url);
                $('#jobs').val(JK_SETTINGS.jobs.join(','));
                $('#polling-time').val(JK_SETTINGS.pollingTime / 1000);
            }
        });
    };
    
    _initTrayIcon = function(trayIconCallback){
        var menu = Titanium.UI.createMenu();
        _tray = Titanium.UI.addTray('app://images/gray.png', trayIconCallback || function(){});
        _TrayMenu.forEach(function(val){
            var item = Titanium.UI.createMenuItem(val.label, val.callback);
            menu.appendItem(item);
        });
        _tray.setMenu(menu);
    };
    
    _setBadge = function(string){
        Titanium.UI.setBadge(string);
    };
    
    _n = _showNotification = function(message, show){
        var notification = Titanium.Notification.createNotification({
            title: Titanium.App.getName(),
            message: message,
            timeout: 10,
            icon: 'app://images/notification_icon.png'
        });
        if (!show || !!show === true) {
            notification.show();
        }
        return notification;
    };
    
    _updateStatusBar = function(text){
        _statusBar.text(text);
    };
    
    _cleanStatusBar = function(){
        _updateStatusBar('');
    };
    
    _loadJenkinsData = function(job, buildNumber, onload){
        buildNumber = buildNumber || 'lastBuild';
        var url = JK_SETTINGS.url + job + '/' + buildNumber + JK_XML_API_URL,
            loader = Titanium.Network.createHTTPClient();
        _updateStatusBar('Contacting ' + url);
        loader.onload = function(){
            var r = this.responseText,
                pResponse = {}, result;
            if (r && r.length > 0) {
            	result = $(r).find('result');
	            pResponse.success = (result && result.text() === JK_STATUS.success) ? true : false; 
	            _cleanStatusBar('');
	            if (result.length > 0) {
		            if (!pResponse.success) {
		            	$('#' + job).removeClass('inactive green').addClass('red');
		                _tray.setIcon('app://images/red.png');
		                _jobStatus [job] = JK_STATUS.failure;
		                _setBadge('!');
		            }
		            else {
		            	$('#' + job).removeClass('inactive red').addClass('green');
		                _tray.setIcon('app://images/green.png');
		                _jobStatus [job] = JK_STATUS.success;
		            }
		        }
		        else {
		        	//Unknown
		        }
	            if (typeof onload === 'function') {
	                onload();
	            }
	    	}
        };
        loader.onreadystatechange = function(){
        	if (loader.readyState === 4) {
        		$('#' + job).removeClass('red green').addClass('inactive');
        	}
        };
        loader.open("GET", url);
        loader.send();
    };
    
    _determineGlobalStatus = function(){
    	var globalStatus;
    	_jobStatus.forEach(function(val) {
			if (val === JK_STATUS.success) {
				if (!globalStatus || globalStatus === JK_STATUS.success) {
					//Only success if it's the first iteration
					//or everytning analyzed so far is success
					globalStatus = JK_STATUS.success;	
				}
			}
			else if (val === JK_STATUS.failure) {
				//Has priority over success, not over inactive
				if (!globalStatus
					|| globalStatus === JK_STATUS.success 
					|| globalStatus === JK_STATUS.failure) {
					globalStatus = JK_STATUS.failure;
				}
    		}
    		else {
    			//Uhmm... JK_STATUS.inactive
    			//this has priority, something
    			//is not working properly,
    			//e.g. no connectivity
    			globalStatus = JK_STATUS.inactive;
    		}
    	});
    	switch (globalStatus) {
    		case JK_STATUS.inactive:
    			_tray.setIcon('app://images/gray.png');
    			break;
    		case JK_STATUS.success:
    			_tray.setIcon('app://images/green.png');
    			break;
    		case JK_STATUS.failure:
    			_tray.setIcon('app://images/red.png');
    			break;
    	}
    	//If status changes, notify
    	if (_currentStatus !== globalStatus) {
    		_currentStatus = globalStatus;
    		_n('Build status changed to: ' + _currentStatus);
    	}
    };
    
    window.JenkinsX = JenkinsX;
})(jQuery);

$(document).ready(function(){
    new JenkinsX();
});
