// 定義Angular Module - ** 在這裡要引入"highcharts-ng"的模組 **
var rtwApp = angular.module('rtwApp', ["highcharts-ng","chartsExample.directives"]);

// 定義Angular Controller
rtwApp.controller('rtwAppCtrl', function ($scope) {
    // 全域變數
    var mqtt_client;
    // 初始view model的資料與變數
    $scope.vm = {};
    $scope.vm.mqtt_host = mqttConfig.host;
    $scope.vm.mqtt_port = mqttConfig.port;
    $scope.vm.user_id = "";
    $scope.vm.gp = "";
    $scope.vm.topic = "";
    $scope.vm.message = 0;
    $scope.vm.gpmessage = "";
    $scope.vm.is_connected = false;
    $scope.vm.is_chartmode = false;
    $scope.vm.is_gpmode = false;
    $scope.vm.subscribe_topic = "chat";
    $scope.vm.btn_subscribe = "Subscribe";
    $scope.vm.is_subscribed = false;
    $scope.vm.subscribed_topics = [];
    $scope.vm.inbound_messages = [];
    $scope.vm.online_users = [];
    $scope.vm.gpchannels = [];

    // 初始圖表的資料與變數
    $scope.vm.chart_data_type = "move";
    $scope.vm.chart_data_move = 0;
    $scope.vm.chart_data_exercise = 0;
    $scope.vm.chart_data_standard = 0;

    // 設定UI會觸發的動作
    $scope.action = {};            
    // **動作: 連接MQTT Broker
    $scope.action.connect_mqtt = function () {
        // 檢查user_id不能為空
        if ($scope.vm.user_id.length === 0) {
            alert("User ID could not be empty!")
            return;
        }
        // 更新圖表的抬頭
        $scope.chartConfig.title.text = "活動力: " + $scope.vm.user_id;

        // 產生mqtt連結client物件的instance
        mqtt_client = new Paho.MQTT.Client($scope.vm.mqtt_host, Number($scope.vm.mqtt_port), Math.uuid(8, 16));
        // 設定某些事件的回呼處理的functions
        mqtt_client.onConnectionLost = onConnectionLost;
        mqtt_client.onMessageArrived = onMessageArrived;

        // 設定LWT的訊息
        var lastwill_topic = "rtwchat/user/" + $scope.vm.user_id + "/presence";
        var lastwill_msg = new Paho.MQTT.Message("offline");
        lastwill_msg.destinationName = lastwill_topic;
        lastwill_msg.retained = true;

        // 連接mqtt broker
        mqtt_client.connect({ onSuccess: onConnect, willMessage: lastwill_msg });

        // 當成功建立mqtt broker的連結時會被呼叫的function
        function onConnect() {
            // UI元件的控制
            $scope.vm.is_connected = true;

            // 訂閱所有使用者上線的訊息"rtwchat/user/+/presence"
            var presence_topic = "rtwchat/user/+/presence";
            mqtt_client.subscribe(presence_topic);
            $scope.vm.subscribed_topics.push(presence_topic);

            // 送出使用者上線的訊息到"rtwchat/{user_id}/presence"
            var mqtt_message = new Paho.MQTT.Message("online");
            mqtt_message.destinationName = "rtwchat/user/" + $scope.vm.user_id + "/presence";
            mqtt_message.retained = true; // *** 設成保留訊息 ***
            mqtt_client.send(mqtt_message);

            // 訂閱自己的Private-Chat主題"rtwchat/user/+/chat/+"
            var private_chat_topic = "rtwchat/user/" + $scope.vm.user_id + "/chat/+";
            mqtt_client.subscribe(private_chat_topic);
            $scope.vm.subscribed_topics.push(private_chat_topic);

            // 訂閱自己的Chart Data主題"rtwchat/user/+/chart/+"
            var private_chat_topic = "rtwchat/user/" + $scope.vm.user_id + "/chart/+";
            mqtt_client.subscribe(private_chat_topic);
            $scope.vm.subscribed_topics.push(private_chat_topic);

            $scope.$apply(); //<--這個動作通知angular.js來觸發data-binding的sync
        }
        // 當與mqtt broker的連結被斷開時會被呼叫的function
        function onConnectionLost(responseObject) {
            if (responseObject.errorCode == 0) { //正常的斷線
                console.log("onConnectionLost:" + responseObject.errorMessage);
            }
            else {
                // UI元件的控制
                $scope.vm.is_connected = false;
                $scope.$apply(); //<--這個動作通知angular.js來觸發data-binding的sync
            }
        }
        // 當訂閱的主題有訊息時會被呼叫的callback function
        function onMessageArrived(message) {
            // 把訊息的主要資訊擷取出來
            var topic = message.destinationName;
            // 建構一個訊息資訊物件
            var msgObj = {
                'topic': message.destinationName,
                'retained': message.retained,
                'qos': message.qos,
                'payload': message.payloadString,
                'eventdt': moment().format('YYYY-MM-DD, hh:mm:ss')
            };

            // 使用html的table來秀出訊息
            $scope.vm.inbound_messages.unshift(msgObj); //最新進來的訊息透在最上面   

            // 使用regular expression來偵測是否為"presence"訊息
            var regex = "rtwchat/user/(.+)/presence";
            var found = topic.match(regex);
            if (found) { // this is "Presence" message
                var user_id = found[1]; //get the "userid" from regular expression matching 
                var idx = $scope.vm.online_users.indexOf(user_id); // 檢查在UI的array中是否存在相同的使用者
                if (msgObj.payload == "online") {
                    if (idx == -1)
                        $scope.vm.online_users.push(user_id);
                }
                else {
                    if (idx != -1)
                        $scope.vm.online_users.splice(idx, 1);
                }
            }

            // 使用regular expression來偵測是否為"chart"訊息
            regex = "rtwchat/user/(.+)/chart/(.+)";
            found = topic.match(regex);
            if (found) { // this is "Chart data" message
                var user_id_to = found[1]; //get the "userid" from regular expression matching 
                var chartData_Type = found[2]; //get the "chart_data_type" from regular expression matching
                var chartData = Number(msgObj.payload);
                update_chart_data(chartData_Type, chartData);
            }

            $scope.$apply(); //<--這個動作通知angular.js來觸發data-binding的sync
        }
    };
    // **動作: 斷開MQTT Broker連線
    $scope.action.disconnect_mqtt = function () {
        // 送出要離線的"offline"訊息
        var presence_topic = "rtwchat/user/" + $scope.vm.user_id + "/presence";
        var mqtt_message = new Paho.MQTT.Message("offline");
        mqtt_message.destinationName = presence_topic;
        mqtt_message.retained = true; //設成retained

        mqtt_client.send(mqtt_message);

        // 斷開 MQTT connection
        mqtt_client.disconnect();

        $scope.vm.is_connected = false;
        // 清空UI暫存資料
        $scope.vm.subscribed_topics = [];
        $scope.vm.inbound_messages = [];
        $scope.vm.online_users = [];
        $scope.vm.gpchannels = [];
    };
    // **動作: 送出訊息
    $scope.action.send_message = function () {
        var mqtt_message = new Paho.MQTT.Message($scope.vm.message+""); //轉換數字成文字
        // rtwchat/user/{user_id:TO}/chart/{chart_data_type}
        mqtt_message.destinationName = $scope.vm.topic + "/" + $scope.vm.chart_data_type;
        mqtt_message.retained = true; // 設成retained
        mqtt_client.send(mqtt_message);
    };
    $scope.action.send_gpmessage = function () {
        var mqtt_message = new Paho.MQTT.Message($scope.vm.gpmessage); //轉換數字成文字
        mqtt_message.destinationName = $scope.vm.topic + "/" + $scope.vm.user_id;
        mqtt_message.retained = true; // 設成retained
        mqtt_client.send(mqtt_message);
    };
    // **動作: 訂閱訊息主題
    $scope.action.subscribe_topic = function () {
        // 先檢查是有有訂閱過
        var idx = $scope.vm.subscribed_topics.indexOf($scope.vm.subscribe_topic);
        if (idx == -1) {
            // 要訂閱訊息主題
            mqtt_client.subscribe($scope.vm.subscribe_topic);
            $scope.vm.subscribed_topics.push($scope.vm.subscribe_topic);
        }
    };
    // **動作: 取消訂閱
    $scope.action.unsubscribe_topic = function (topic_to_unsubscribe) {
        // 要解除訂閱
        mqtt_client.unsubscribe(topic_to_unsubscribe);
        // 移除在UI上的subscribed topics列表
        var idx = $scope.vm.subscribed_topics.indexOf(topic_to_unsubscribe);
        if (idx != -1)
            $scope.vm.subscribed_topics.splice(idx, 1);
    };
    // **動作: 產生"private-chat"的topic
    $scope.action.build_private_chart_topic = function (user_to_chart) {
        // rtwchat/user/{user_id:TO}/chart/{chart_data_type}
        $scope.vm.topic = "rtwchat/user/" + user_to_chart + "/chart";
        $scope.vm.is_chartmode = true;
        $scope.vm.is_gpmode = false;
        $scope.$apply();
    }
    $scope.action.build_private_channel_topic = function (gp_to_chart) {
        // rtwchat/user/{user_id:TO}/chart/{chart_data_type}
        $scope.vm.topic = "rtwchat/group/" + gp_to_chart + "/chat";
        $scope.vm.is_chartmode = false;
        $scope.vm.is_gpmode = true;
        $scope.$apply();
    }
    // register gp
    $scope.action.register_group = function(){
        $scope.vm.gpchannels.push($scope.vm.gp);
        var private_chat_topic = "rtwchat/group/" + $scope.vm.gp + "/chat/+";
        mqtt_client.subscribe(private_chat_topic);
        $scope.vm.subscribed_topics.push(private_chat_topic);
        $scope.vm.gp = "";
        $scope.$apply();
    }
    // **動作: 更新Highchart資料物件的內容
    update_chart_data = function (chart_data_type, chart_data) {
        // 取得原生的highchart的物件instance
        var highchart = $scope.chartConfig.getHighcharts();
        // 透過原本的highchart的API來修改圖表的資料
        if (chart_data_type === "move") {
            highchart.series[0].setData([{
                color: Highcharts.getOptions().colors[0],
                radius: '100%',
                innerRadius: '100%',
                y: chart_data
            }]);
        } else if (chart_data_type === "exercise") {
            highchart.series[1].setData([{
                color: Highcharts.getOptions().colors[1],
                radius: '75%',
                innerRadius: '75%',
                y: chart_data
            }]);
        } else if (chart_data_type === "standard") {
            highchart.series[2].setData([{
                color: Highcharts.getOptions().colors[2],
                radius: '50%',
                innerRadius: '50%',
                y: chart_data
            }]);
        }
    };
    $scope.onlineChartConfig = {          
        options: {
            chart: {
                type: 'spline',
                animation: Highcharts.svg,
                events: {
                    load: function() {
                        var series = this.series[0];
                        var str = JSON.stringify(series);
                        console.log(series);
                        setInterval(function(){
                            var x = (new Date()).getTime(), y = $scope.vm.online_users.length;
                            series.addPoint([x, y], true, true);
                        }, 1000);
                    }
                }
            }
        },
        title: {
            text: 'Live online users'
        },
        xAxis: {
            type: 'datetime',
            tickPixelInterval: 150
        },
        yAxis: {
            plotLines: [{
                value: 0,
                width: 1,
                color: '#808080'
            }]
        },
        tooltip: {
            formatter: function () {
                return '<b>' + this.series.name + '</b><br/>' +
                Highcharts.dateFormat('%Y-%m-%d %H:%M:%S', this.x) + '<br/>' +
                Highcharts.numberFormat(this.y, 2);
            }
        },
        legend: {
            enabled: false
        },
        exporting: {
            enabled: false
        },
        series: [{
            name: 'Online users',
            data: (function(){
                var data = [],
                    time = (new Date()).getTime();
                data.push({
                    x: time,
                    y: $scope.vm.online_users.length
                });
                return data;
            }())
        }]
    };

    // 設定要繋結到Highchart的chartConfig物件
    $scope.chartConfig = {
        options: {
            //This is the Main Highcharts chart config. Any Highchart options are valid here.
            //will be overriden by values specified below.
            chart: {
                type: 'solidgauge',
                marginTop: 50
            },
            pane: {
                startAngle: 0,
                endAngle: 360,
                background: [{ // Track for Move
                    outerRadius: '112%',
                    innerRadius: '88%',
                    backgroundColor: Highcharts.Color(Highcharts.getOptions().colors[0]).setOpacity(0.3).get(),
                    borderWidth: 0
                }, { // Track for Exercise
                    outerRadius: '87%',
                    innerRadius: '63%',
                    backgroundColor: Highcharts.Color(Highcharts.getOptions().colors[1]).setOpacity(0.3).get(),
                    borderWidth: 0
                }, { // Track for Stand
                    outerRadius: '62%',
                    innerRadius: '38%',
                    backgroundColor: Highcharts.Color(Highcharts.getOptions().colors[2]).setOpacity(0.3).get(),
                    borderWidth: 0
                }]
            },
            plotOptions: {
                solidgauge: {
                    borderWidth: '34px',
                    dataLabels: {
                        enabled: false
                    },
                    linecap: 'round',
                    stickyTracking: false
                }
            },
            tooltip: {
                borderWidth: 0,
                backgroundColor: 'none',
                shadow: false,
                style: {
                    fontSize: '16px'
                },
                pointFormat: '{series.name}<br><span style="font-size:2em; color: {point.color}; font-weight: bold">{point.y}%</span>',
                positioner: function (labelWidth, labelHeight) {
                    return {
                        x: 200 - labelWidth / 2,
                        y: 180
                    };
                }
            }
        },
        title: {
            text: "活動力",
            style: {
                fontSize: '20px',
                fontFamily: 'Microsoft JhengHei'
            }
        },                
        yAxis: {
            min: 0,
            max: 100,
            lineWidth: 0,
            tickPositions: []
        },
        credits: {
            enabled: true
        },
        series: [{
            name: 'Move',
            borderColor: Highcharts.getOptions().colors[0],
            data: [{
                color: Highcharts.getOptions().colors[0],
                radius: '100%',
                innerRadius: '100%',
                y: $scope.vm.chart_data_move
            }]
        }, {
            name: 'Exercise',
            borderColor: Highcharts.getOptions().colors[1],
            data: [{
                color: Highcharts.getOptions().colors[1],
                radius: '75%',
                innerRadius: '75%',
                y: $scope.vm.chart_data_exercise
            }]
        }, {
            name: 'Stand',
            borderColor: Highcharts.getOptions().colors[2],
            data: [{
                color: Highcharts.getOptions().colors[2],
                radius: '50%',
                innerRadius: '50%',
                y: $scope.vm.chart_data_standard
            }]
        }]
    };
    $scope.onlineChart = {
        chart: {
            type: 'spline',
            animation: Highcharts.svg, // don't animate in old IE
            marginRight: 10,
            events: {
                load: function() {
                    // set up the updating of the chart each second
                    var series = this.series[0];
                    setInterval(function() {
                        var x = (new Date()).getTime(), // current time
                            y = $scope.vm.online_users.length;
                        series.addPoint([x, y], true, true);
                    }, 1000);
                }
            }
        },
        title: {
            text: 'Live online users'
        },
        xAxis: {
            type: 'datetime',
            //tickPixelInterval: 150
        },
        yAxis: {
            title: {
                text: 'Value'
            },
            plotLines: [{
                value: 0,
                width: 1,
                color: '#808080'
            }]
        },
        tooltip: {
            formatter: function() {
                    return '<b>'+ this.series.name +'</b><br/>'+
                    Highcharts.dateFormat('%Y-%m-%d %H:%M:%S', this.x) +'<br/>'+
                    Highcharts.numberFormat(this.y, 2);
            }
        },
        series: [{
            name: 'Online users',
            data: (function() {
                // generate an array of random data
                var data = [],
                    time = (new Date()).getTime(),
                    i;
                    for (i = -19; i <= 0; i++) {
                        data.push({
                            x: time + i * 1000,
                            y: 0
                        });
                    }
                return data;
            })()
        }]
    }   
});