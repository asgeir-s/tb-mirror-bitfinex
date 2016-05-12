import * as WebSocket from "ws"
import * as crypto from "crypto"
import * as R from "ramda"
import { DynamoDB } from "aws-sdk"
import * as http from "http"
import * as https from "https"
import * as Promise from "bluebird"

const mirrorTableName = process.env.MIRROR_TABLE
const signalServiceUrl = process.env.SIGNAL_SERVICE_URL
const signalServiceApiKey = process.env.SIGNAL_SERVICE_API_KEY
const documentClient: any = new DynamoDB.DocumentClient({
  "region": process.env.REGION
})

const mirrors = new Map<string, any>()

http.createServer((request: any, response: any) => {
  if (request.method === "GET" && request.url === "/new-mirror") {
    console.log("setup new websocket(s)")
    getAllMirrorsFromDynamo(documentClient, mirrorTableName)
      .map((mirror: Mirror) => {
        if (!mirrors.has(mirror.streamId)) {
          console.log("new web socket for stream with id: " + mirror.streamId)
          mirrors.set(mirror.streamId, setupWs(mirror.streamId, mirror.apiKey, mirror.apiSecret, 0))
        }
      })
      .then(response.end("OK"))
  }
}).listen(80)

getAllMirrorsFromDynamo(documentClient, mirrorTableName)
  .map((mirror: Mirror) => {
    console.log("initial setup of websockets")
    mirrors.set(mirror.streamId, setupWs(mirror.streamId, mirror.apiKey, mirror.apiSecret, 0))
  })

function setupWs(streamId: string, apiKey: string, apiSecret: string, reconnectRetrys: number): WebSocket {
  const ws = new WebSocket("wss://api2.bitfinex.com:3000/ws")
  let timeout: NodeJS.Timer
  resetTimeout()

  ws.on("open", () => {
    resetTimeout()
    log("open")
    reconnectRetrys = 0
    const payload = "AUTH" + (new Date().getTime())
    const signature = crypto.createHmac("sha384", apiSecret).update(payload).digest("hex")

    log("send subscribe message")
    ws.send(JSON.stringify({
      event: "auth",
      apiKey: apiKey,
      authSig: signature,
      authPayload: payload
    }))
  })

  ws.on("error", error => log("error: " + JSON.stringify(error)))

  ws.on("close", (code: number, message: string) => {
    log("CLOSE websocket: code: " + code + ", message: " + message)
    ws.terminate()
  })

  ws.on("message", (rawData, flags) => {
    resetTimeout()

    // data[1]: event
    const data = JSON.parse(rawData)

    if (data[1] === "ps") {
      const positionBtcUsd = R.find((pos => pos[0] === "BTCUSD"), data[2] as Array<Array<any>>)

      if (positionBtcUsd == null) {
        postSignal(signalServiceUrl, signalServiceApiKey, guid(), streamId, 0, 4)
          .then((signal) => log("postSignal responds: " + JSON.stringify(signal)))
      }

      else if (positionBtcUsd[1] === "ACTIVE") {
        if (positionBtcUsd[2] > 0) {
          postSignal(signalServiceUrl, signalServiceApiKey, guid(), streamId, 1, 4)
            .then((signal) => log("postSignal responds: " + JSON.stringify(signal)))
        }
        else if (positionBtcUsd[2] < 0) {
          postSignal(signalServiceUrl, signalServiceApiKey, guid(), streamId, -1, 4)
            .then((signal) => log("postSignal responds: " + JSON.stringify(signal)))
        }
      }
    }

    else if (data[1] === "pu" && data[2][0] === "BTCUSD" && data[2][1] === "ACTIVE") {
      if (data[2][2] > 0) {
        postSignal(signalServiceUrl, signalServiceApiKey, guid(), streamId, 1, 4)
          .then((signal) => log("postSignal responds: " + JSON.stringify(signal)))
      }
      else if (data[2][2] < 0) {
        postSignal(signalServiceUrl, signalServiceApiKey, guid(), streamId, -1, 4)
          .then((signal) => log("postSignal responds: " + JSON.stringify(signal)))
      }
    }

    else if (data[1] === "pc" && data[2][0] === "BTCUSD" && data[2][1] === "CLOSED") {
      postSignal(signalServiceUrl, signalServiceApiKey, guid(), streamId, 0, 4)
        .then((signal) => log("postSignal responds: " + JSON.stringify(signal)))

    }

    else if (data.event != null && data.event === "info") {
      log("got info event: " + JSON.stringify(data))

      if (data.code === 20051 || data.code === 20061) {
        ws.terminate()
      }
    }

    else if (data.event === "auth" && data.status === "FAILED") {
      log("failed to authenticate for streamId: " + streamId + ". Will not try to reconnect.")
      mirrors.set(streamId, "could not authenticate")
      ws.terminate()
      clearTimeout(timeout)
    }
    // log("data[1] " + data[1])
    // log("message data: " + JSON.stringify(data))
  })

  function resetTimeout() {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      ws.terminate()
      setupWs(streamId, apiKey, apiSecret, reconnectRetrys + 1)
    }, 10000)
  }

  function log(message: string) {
    console.log("[" + streamId + "] " + message)
  }

  return ws
}

/**
 * Returns the created signal (with all 'Signal' attributes)
 */
export function postSignal(signalServiceUrl: string, signalServiceApiKey: string, GRID: string,
  streamId: string, signal: number, retrysLeft: number): Promise<any> {
  console.log("[" + streamId + "] posting signal: " + signal + ", with GRID: " + GRID)
  return new Promise<Array<Signal>>((resolve, reject) => {
    if (retrysLeft === 0) {
      reject("no more retrys. Failed to post signal")
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
      let responseString = ""
      res.on("data", (data: any) => {
        responseString += data
      })
      res.on("end", () => {
        resolve(JSON.parse(responseString))
      })
      res.on("error", () => postSignal(signalServiceUrl, signalServiceApiKey, GRID, streamId, signal, retrysLeft - 1))
    }).end(signal.toString())
  })
}

function getAllMirrorsFromDynamo(documentClient: any, tableName: string) {
  return new Promise<Array<Mirror>>((resolve, reject) => {
    documentClient.scan({
      TableName: "mirror-bitfinex"
    }, (err: any, data: any) => {
      if (err) {
        reject(err)
      }
      else {
        resolve(data.Items)
      }
    })
  })
}

function guid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c == "x" ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

interface Mirror {
  streamId: string,
  apiKey: string,
  apiSecret: string
}

interface Signal {
  timestamp: number
  price: number
  change: number
  id: number
  valueInclFee: number
  changeInclFee: number
  value: number
  signal: number
}