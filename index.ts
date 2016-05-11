import * as WebSocket from "ws"
import * as crypto from "crypto"
import * as R from "ramda"
import { DynamoDB } from "aws-sdk"

// get all mirrors with streamId, apiKey and apiSecret

// for each mirror setupWS

DynamoDB

setupWs(
  "some-stream-id",
  "KXogve6W91hVa2ZSTkjpVaBYSwCv8CaGY0arNX4Phq6",
  "uM2uUr52o3W1Q4BIIKnwmknjPDOK08E6m1v5mXpxwDA",
  0)

setupWs(
  "some-stream-id",
  "MlDmSkVYVK2ls9dbI5UcyGKzz7b3wWNc6iimAwv3nRA",
  "Phh7c6gT2Zg0RjFaVKkY1tRhD87DJvvxLon6HKw0aEQ",
  0)

function setupWs(streamId: string, apiKey: string, apiSecret: string, reconnectRetrys: number): WebSocket {
  const ws = new WebSocket("wss://api2.bitfinex.com:3000/ws")
  let timeout: NodeJS.Timer
  resetTimeout()

  ws.on("open", () => {
    resetTimeout()
    console.log("open")
    reconnectRetrys = 0
    const payload = "AUTH" + (new Date().getTime())
    const signature = crypto.createHmac("sha384", apiSecret).update(payload).digest("hex")

    console.log("send subscribe message")
    ws.send(JSON.stringify({
      event: "auth",
      apiKey: apiKey,
      authSig: signature,
      authPayload: payload
    }))
  })

  ws.on("error", error => console.log("error: " + JSON.stringify(error)))

  ws.on("close", (code: number, message: string) => {
    console.log("CLOSE: code: " + code + ", message: " + message)
    ws.terminate()
  })

  ws.on("message", (rawData, flags) => {
    resetTimeout()

    // data[1]: event
    const data = JSON.parse(rawData)

    if (data[1] === "ps") {
      const positionBtcUsd = R.find((pos => pos[0] === "BTCUSD"), data[2] as Array<Array<any>>)

      if (positionBtcUsd == null) {
        console.log("position: CLOSE")
      }

      else if (positionBtcUsd[1] === "ACTIVE") {
        if (positionBtcUsd[2] > 0) {
          console.log("position: LONG")
        }
        else if (positionBtcUsd[2] < 0) {
          console.log("position: SHORT")
        }
      }
    }

    else if (data[1] === "pu" && data[2][0] === "BTCUSD" && data[2][1] === "ACTIVE") {
      if (data[2][2] > 0) {
        console.log("position: LONG")
      }
      else if (data[2][2] < 0) {
        console.log("position: SHORT")
      }
    }

    else if (data[1] === "pc" && data[2][0] === "BTCUSD" && data[2][1] === "CLOSED") {
      console.log("position: CLOSE")
    }

    else if (data.event != null && data.event === "info") {
      console.log("got info event: " + JSON.stringify(data))

      if (data.code === 20051 || data.code === 20061) {
        ws.terminate()
      }
    }

    else if (data.event === "auth" && data.status === "FAILED") {
      console.log("failed to authenticate for streamId: " + streamId + ". Will not try to reconnect.")
      clearTimeout(timeout)
    }
    // console.log("data[1] " + data[1])
    // console.log("message data: " + JSON.stringify(data))
  })

  function resetTimeout() {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      ws.terminate()
      setupWs(streamId, apiKey, apiSecret, reconnectRetrys + 1)
    }, 10000)
  }

  return ws
}