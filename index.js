"use strict";
const WebSocket = require("ws");
const crypto = require("crypto");
const R = require("ramda");
const aws_sdk_1 = require("aws-sdk");
const http = require("http");
const mirrors = new Map();
http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/new-mirror") {
        documentClient.scan({
            TableName: "mirror-bitfinex"
        }, (err, data) => {
            if (err) {
                console.log(err);
            }
            else {
                console.log("setting up new websocket(s)");
                console.log(data);
                data.Items.forEach((item) => {
                    if (!mirrors.has(item.streamId)) {
                        console.log("new web socket for stream with id: " + item.streamId);
                        mirrors.set(item.streamId, setupWs(item.streamId, item.apiKey, item.apiSecret, 0));
                    }
                });
            }
        });
        response.end("OK");
    }
}).listen(8080);
const documentClient = new aws_sdk_1.DynamoDB.DocumentClient({
    "region": "us-east-1"
});
documentClient.scan({
    TableName: "mirror-bitfinex"
}, (err, data) => {
    if (err) {
        console.log(err);
    }
    else {
        console.log("initial setup of websockets");
        console.log(data);
        data.Items.forEach((item) => {
            mirrors.set(item.streamId, setupWs(item.streamId, item.apiKey, item.apiSecret, 0));
        });
    }
});
function setupWs(streamId, apiKey, apiSecret, reconnectRetrys) {
    const ws = new WebSocket("wss://api2.bitfinex.com:3000/ws");
    let timeout;
    resetTimeout();
    ws.on("open", () => {
        resetTimeout();
        log("open");
        reconnectRetrys = 0;
        const payload = "AUTH" + (new Date().getTime());
        const signature = crypto.createHmac("sha384", apiSecret).update(payload).digest("hex");
        log("send subscribe message");
        ws.send(JSON.stringify({
            event: "auth",
            apiKey: apiKey,
            authSig: signature,
            authPayload: payload
        }));
    });
    ws.on("error", error => log("error: " + JSON.stringify(error)));
    ws.on("close", (code, message) => {
        log("CLOSE: code: " + code + ", message: " + message);
        ws.terminate();
    });
    ws.on("message", (rawData, flags) => {
        resetTimeout();
        const data = JSON.parse(rawData);
        if (data[1] === "ps") {
            const positionBtcUsd = R.find((pos => pos[0] === "BTCUSD"), data[2]);
            if (positionBtcUsd == null) {
                log("position: CLOSE");
            }
            else if (positionBtcUsd[1] === "ACTIVE") {
                if (positionBtcUsd[2] > 0) {
                    log("position: LONG");
                }
                else if (positionBtcUsd[2] < 0) {
                    log("position: SHORT");
                }
            }
        }
        else if (data[1] === "pu" && data[2][0] === "BTCUSD" && data[2][1] === "ACTIVE") {
            if (data[2][2] > 0) {
                log("position: LONG");
            }
            else if (data[2][2] < 0) {
                log("position: SHORT");
            }
        }
        else if (data[1] === "pc" && data[2][0] === "BTCUSD" && data[2][1] === "CLOSED") {
            log("position: CLOSE");
        }
        else if (data.event != null && data.event === "info") {
            log("got info event: " + JSON.stringify(data));
            if (data.code === 20051 || data.code === 20061) {
                ws.terminate();
            }
        }
        else if (data.event === "auth" && data.status === "FAILED") {
            log("failed to authenticate for streamId: " + streamId + ". Will not try to reconnect.");
            mirrors.set(streamId, "could not authenticate");
            ws.terminate();
            clearTimeout(timeout);
        }
    });
    function resetTimeout() {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            ws.terminate();
            setupWs(streamId, apiKey, apiSecret, reconnectRetrys + 1);
        }, 10000);
    }
    function log(message) {
        console.log("[" + streamId + "] " + message);
    }
    return ws;
}
//# sourceMappingURL=index.js.map