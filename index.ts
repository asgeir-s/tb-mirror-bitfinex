import * as WebSocket from "ws"
import * as crypto from "crypto"
import * as R from "ramda"

const ws = new WebSocket("wss://api2.bitfinex.com:3000/ws")

/**
 * WebSocket connection is open. Ready to send.
 * @event BitfinexWS#open
 */
ws.on("open", () => {
  console.log("open")

  // private
  const apiKey = "KXogve6W91hVa2ZSTkjpVaBYSwCv8CaGY0arNX4Phq6"
  const apiSecret = "uM2uUr52o3W1Q4BIIKnwmknjPDOK08E6m1v5mXpxwDA"
  const payload = "AUTH" + (new Date().getTime())
  const signature = crypto.createHmac("sha384", apiSecret).update(payload).digest("hex")

  console.log("sends subscribe message")
  ws.send(JSON.stringify({
    event: "auth",
    apiKey: apiKey,
    authSig: signature,
    authPayload: payload
  }))
})

/**
 * @event BitfinexWS#error
 */
ws.on("error", () => console.log("error"))

/**
 * WebSocket connection is closed.
 * @event BitfinexWS#close
 */
ws.on("close", () => console.log("close"))

ws.on("message", (rawData, flags) => {
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



  // console.log("data[1] " + data[1])
  // console.log("message data: " + JSON.stringify(data))
})
