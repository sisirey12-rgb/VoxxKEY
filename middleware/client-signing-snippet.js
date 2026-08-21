/* ===== Add this near the top of your <script>, with the other constants ===== */
const LICENSE_API = "https://voxxstore.onrender.com";

// MUST be the exact same string as CLIENT_HMAC_SECRET on the server.
// This is extractable by anyone who views your page source — that's an
// accepted tradeoff for a browser client. It still stops casual/scripted
// abuse; it does not stop a determined reverse-engineer. Rotate this
// value periodically (and update the server env var to match) to limit
// how long a leaked copy stays useful.
const CLIENT_SIGNING_SECRET = "PASTE_THE_SAME_RANDOM_STRING_HERE";

async function signRequest(license_key, hwid, timestamp) {
  const message = `${license_key || ""}|${hwid || ""}|${timestamp}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(CLIENT_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ===== Replace your existing verifyLicense() function with this one ===== */
async function verifyLicense({activate = false} = {}){
    if(licenseChecking) return false;
    const input = document.getElementById("licenseKey");
    const key = (input.value || localStorage.getItem(LICENSE_KEY_STORAGE) || "").trim();
    if(!key){
        setLicenseUI("locked", "Enter your VOXX license key first.");
        return false;
    }

    licenseChecking = true;
    setLicenseUI("checking", activate ? "Activating license and binding this browser…" : "Validating saved license…");

    try{
        const endpoint = activate ? "/api/activate" : "/api/validate";
        const hwid = getBrowserHWID();
        const timestamp = Date.now().toString();
        const signature = await signRequest(key, hwid, timestamp);

        const response = await fetch(LICENSE_API.replace(/\/$/, "") + endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Client-Timestamp": timestamp,
                "X-Client-Signature": signature
            },
            body: JSON.stringify({
                license_key: key,
                hwid: hwid
            })
        });

        let data = {};
        try { data = await response.json(); } catch(e) {}

        if(!response.ok || data.success === false || data.valid === false){
            const reason = licenseReason(data.reason);
            setLicenseUI("error", reason);
            return false;
        }

        localStorage.setItem(LICENSE_KEY_STORAGE, key);
        setLicenseUI("active", activate ? "License activated successfully." : "License validated successfully.", data);
        return true;
    } catch(error){
        setLicenseUI("error", "Couldn't reach the license server. Check your connection.");
        return false;
    } finally {
        licenseChecking = false;
    }
}
