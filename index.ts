// import { fetchWeatherApi } from "openmeteo";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import TuyAPI from "tuyapi";

dotenv.config();

// Capture logs
const logBuffer: string[] = [];
const originalConsoleLog = console.log;
console.log = (...args: any[]) => {
  const message = args.map(String).join(" ");
  logBuffer.push(message);
  originalConsoleLog(...args);
};

async function sendEmail(subject: string, text: string) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // Append logs to the email body
  const logs = logBuffer.join("\n");
  const emailBody = `${text}\n\n---\nConsole Logs:\n${logs}`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_TO,
    subject: process.env.MAIL_SUBJECT_PREFIX
      ? `${process.env.MAIL_SUBJECT_PREFIX} ${subject}`
      : subject,
    text: emailBody,
  });
}

async function getAverageCloudCover(): Promise<number> {
  // const params = {
  //   latitude: process.env.LATITUDE,
  //   longitude: process.env.LONGITUDE,
  //   hourly: "cloud_cover",
  //   timezone: "auto",
  //   forecast_days: 1,
  // };
  // const url = "https://api.open-meteo.com/v1/forecast";
  // const responses = await fetchWeatherApi(url, params);

  // // Process first location. Add a for-loop for multiple locations or weather models
  // const response = responses[0];

  // const hourly = response.hourly()!;
  // console.log(hourly)
  // const weatherData = {
  //   hourly: {
  //     cloud_cover: hourly.variables(0)!.valuesArray(),
  //   },
  // };

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${process.env.LATITUDE}&longitude=${process.env.LONGITUDE}&hourly=cloud_cover&timezone=auto&forecast_days=1`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.log(`HTTP error! status: ${response.status}`);
      return -1; // Indicate an error occurred
    }

    const data = await response.json();
    // We're interested in cloud cover between 9am and 4pm local time

    const cloudCoverDaytime = data.hourly.cloud_cover.slice(9, 16);
    const cloudCoverDaytimeAvg =
      cloudCoverDaytime.reduce((a, b) => a + b, 0) / cloudCoverDaytime.length;

    return cloudCoverDaytimeAvg;

  } catch (error) {
    console.log('Error fetching data:', error);
    return -1; // Indicate an error occurred
  }
}

async function setDeviceStatus(status: boolean) {
  const device = new TuyAPI({
    id: process.env.TUYA_DEVICE_ID,
    key: process.env.TUYA_DEVICE_KEY,
    // version: '3.3',
    // ip: '196.64.124.173',
      // issueGetOnConnect: false,
      // issueRefreshOnConnect: true,
  });
  let stateHasChanged = false;

  // Find device on network
  device.find().then(() => {
    // Connect to device
    device.connect();
  }).catch((error) => {
    console.log("Failed to find device:", error);
    sendEmail(
      "Error Connecting to Device",
      `There was an error connecting to the device: ${error.message}`
    );
  });

  // Add event listeners
  device.on("connected", () => {
    console.log("Connected to device!");
    device.set({ set: status });
    if (status) {
      console.log("It's a cloudy day, we can switch on the solar panels!");
      // and send an email to confirm We switch on the panels here
      sendEmail(
        "Solar Heater Activated",
        "The solar heater has been switched on due to high cloud cover."
      );
    } else {
      console.log("It's a sunny day, no need to switch on the solar heater.");
      sendEmail(
        "Solar Heater Deactivated",
        "The solar heater has been switched off due to low cloud cover."
      );
    }
  });

  device.on("disconnected", () => {
    console.log("Disconnected from device.");
  });

  device.on("error", (error) => {
    console.log("Error!", error);
  });

  //   device.on("data", (data) => {
  //     console.log("Data from device:", data);

  //     console.log(`Boolean status of default property: ${data.dps["1"]}.`);

  //     // Set default property to opposite
  //     if (!stateHasChanged) {
  //       device.set({ set: !data.dps["1"] });

  //       // Otherwise we'll be stuck in an endless
  //       // loop of toggling the state.
  //       stateHasChanged = true;
  //     }
  //   });

  // Disconnect after 10 seconds
  setTimeout(() => {
    device.disconnect();
  }, 10000);
}

const cloudCoverDaytimeAvg = await getAverageCloudCover();
console.log(`Average daytime cloud cover: ${cloudCoverDaytimeAvg}%`);

// -1 mean something when wrong when fetching data
if (cloudCoverDaytimeAvg > -1) {
  // If cloud cover is above 70% we can switch on the solar panels
  setDeviceStatus(cloudCoverDaytimeAvg > 70);
}
else {
  sendEmail(
    "Error Fetching Weather Data",
    "There was an error fetching the weather data. Please check the logs for details."
  );
}
