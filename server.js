require("dotenv").config();

const express = require("express");
const cors = require("cors");

const {
  init
} = require("./db");

const licenseRoutes =
  require("./routes/licenseRoutes");

const adminRoutes =
  require("./routes/adminRoutes");

const resellerRoutes =
  require("./routes/resellerRoutes");

const app =
  express();

app.set(
  "trust proxy",
  1
);

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,
      service:
        "voxx-license-server"
    });
  }
);

app.use(
  "/api",
  licenseRoutes
);

app.use(
  "/admin",
  adminRoutes
);

app.use(
  "/reseller",
  resellerRoutes
);

app.use(
  (err, req, res, next) => {

    console.error(
      "[SERVER ERROR]",
      err
    );

    res.status(500).json({
      success: false,
      error:
        "Internal server error"
    });
  }
);

const PORT =
  process.env.PORT || 3000;

init()
  .then(() => {

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Server running on port ${PORT}`
        );
      }
    );

  })
  .catch(err => {

    console.error(
      "Database initialization failed:",
      err
    );

    process.exit(1);
  });
