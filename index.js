"use strict";
const WebSocket = require("ws");
const crypto = require("crypto");
const R = require("ramda");
const aws_sdk_1 = require("aws-sdk");
const http = require("http");
const https = require("https");
const Promise = require("bluebird");
const mirrorTableName = "mirror-bitfinex";
const signalServiceUrl = "ms-signals.tradersbit.com";
const signalServiceApiKey = "Q20fqA194LVw3194xMR5Ue3rcd0hsg2qIgbd4HEklpmqPPxqLYdK473guaq78yYI6JINAj9C7UPBorKCtJ197A32UOc0gD2VfE3h";
const documentClient = new aws_sdk_1.DynamoDB.DocumentClient({
    "region": "us-east-1"
});
const mirrors = new Map();
http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/new-mirror") {
        console.log("setup new websocket(s)");
        getAllMirrorsFromDynamo(documentClient, mirrorTableName)
            .map((mirror) => {
            if (!mirrors.has(mirror.streamId)) {
                console.log("new web socket for stream with id: " + mirror.streamId);
                mirrors.set(mirror.streamId, setupWs(mirror.streamId, mirror.apiKey, mirror.apiSecret, 0));
            }
        })
            .then(response.end("OK"));
    }
}).listen(8080);
getAllMirrorsFromDynamo(documentClient, mirrorTableName)
    .map((mirror) => {
    console.log("initial setup of websockets");
    mirrors.set(mirror.streamId, setupWs(mirror.streamId, mirror.apiKey, mirror.apiSecret, 0));
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
        log("CLOSE websocket: code: " + code + ", message: " + message);
        ws.terminate();
    });
    ws.on("message", (rawData, flags) => {
        resetTimeout();
        const data = JSON.parse(rawData);
        if (data[1] === "ps") {
            const positionBtcUsd = R.find((pos => pos[0] === "BTCUSD"), data[2]);
            if (positionBtcUsd == null) {
                postSignal(signalServiceUrl, signalServiceApiKey, guid(), streamId, 0, 4)
                    .then((signal) => log("postSignal responds: " + JSON.stringify(signal)));
            }
            else if (positionBtcUsd[1] === "ACTIVE") {
                if (positionBtcUsd[2] > 0) {
                    postSignal(signalServiceUrl, signalServiceApiKey, guid(), streamId, 1, 4)
                        .then((signal) => log("postSignal responds: " + JSON.stringify(signal)));
                }
                else if (positionBtcUsd[2] < 0) {
                    postSignal(signalServiceUrl, signalServiceApiKey, guid(), streamId, -1, 4)
                        .then((signal) => log("postSignal responds: " + JSON.stringify(signal)));
                }
            }
        }
        else if (data[1] === "pu" && data[2][0] === "BTCUSD" && data[2][1] === "ACTIVE") {
            if (data[2][2] > 0) {
                postSignal(signalServiceUrl, signalServiceApiKey, guid(), streamId, 1, 4)
                    .then((signal) => log("postSignal responds: " + JSON.stringify(signal)));
            }
            else if (data[2][2] < 0) {
                postSignal(signalServiceUrl, signalServiceApiKey, guid(), streamId, -1, 4)
                    .then((signal) => log("postSignal responds: " + JSON.stringify(signal)));
            }
        }
        else if (data[1] === "pc" && data[2][0] === "BTCUSD" && data[2][1] === "CLOSED") {
            postSignal(signalServiceUrl, signalServiceApiKey, guid(), streamId, 0, 4)
                .then((signal) => log("postSignal responds: " + JSON.stringify(signal)));
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
function postSignal(signalServiceUrl, signalServiceApiKey, GRID, streamId, signal, retrysLeft) {
    console.log("[" + streamId + "] posting signal: " + signal + ", with GRID: " + GRID);
    return new Promise((resolve, reject) => {
        if (retrysLeft === 0) {
            reject("no more retrys. Failed to post signal");
        }
        https.request({
            host: signalServiceUrl,
            path: "/streams/" + streamId + "/signals",
            method: "POST",
            headers: {
                "Global-Request-ID": GRID,
                "content-type": "application/json",
                "Authorization": "apikey " + signalServiceApiKey
            }
        }, res => {
            let responseString = "";
            res.on("data", (data) => {
                console.log("data " + data);
                responseString += data;
            });
            res.on("end", () => {
                console.log("end ");
                resolve(JSON.parse(responseString));
            });
            res.on("error", () => postSignal(signalServiceUrl, signalServiceApiKey, GRID, streamId, signal, retrysLeft - 1));
        }).end(signal.toString());
    });
}
exports.postSignal = postSignal;
function getAllMirrorsFromDynamo(documentClient, tableName) {
    return new Promise((resolve, reject) => {
        documentClient.scan({
            TableName: "mirror-bitfinex"
        }, (err, data) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(data.Items);
            }
        });
    });
}
function guid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0, v = c == "x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
//# sourceMappingURL=index.js.map