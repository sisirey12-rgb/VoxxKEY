require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");

const {
  init
} = require("./db");

const licenseRoutes =
  require("./routes/license");

const adminRoutes =
  require("./routes/admin");

const resellerRoutes =
  require("./routes/reseller");

const authRoutes =
  require("./routes/auth");

const app =
  express();

app.set(
  "trust proxy",
  1
);

app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "X-Admin-Key", "X-Reseller-Token"]
  })
);

app.use(cookieParser());

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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "lolo.html"));
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "voxx-license-server" });
});

app.use(
  "/api",
  licenseRoutes
);

// Admin authentication/login routes are public where appropriate; the
// protected admin router enforces requireSession itself.
app.use("/admin", authRoutes);

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
