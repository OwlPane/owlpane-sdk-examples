import { owlpane, setDeviceContext, emitDeviceLog } from "@owlpane/node";

owlpane.start({
  service: "iot-device-simulator",
  endpoint: process.env.OWLPANE_INGEST_URL ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  ingestKey: process.env.OWLPANE_INGEST_KEY,
  environment: process.env.OWLPANE_ENVIRONMENT ?? "development",
});

if (!owlpane.isEnabled()) {
  console.error("Set OWLPANE_INGEST_URL and OWLPANE_INGEST_KEY");
  process.exit(1);
}

setDeviceContext({
  deviceId: process.env.OWLPANE_DEVICE_ID ?? "sim-device-1",
  fleetId: process.env.OWLPANE_DEVICE_FLEET_ID ?? "lab-fleet",
  deviceClass: "generic",
  firmwareVersion: process.env.OWLPANE_FIRMWARE ?? "1.0.0",
});

async function tick() {
  await emitDeviceLog("heartbeat");
  console.log("heartbeat sent");
}

void tick();
setInterval(() => void tick(), Number(process.env.OWLPANE_INTERVAL_SEC ?? 60) * 1000);
