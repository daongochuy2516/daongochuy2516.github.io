let port;
let reader;
let isConnected = false;
let originalConfig = {};

async function connectDevice() {
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });

        document.getElementById("statusText").innerText = "Connected. Querying device...";

        const writer = port.writable.getWriter();
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        let config = null;
        let attempt = 0;
        const maxAttempts = 10;

        while (attempt < maxAttempts && !config) {
            try {
                //console.log(`Attempt ${attempt + 1} to get config...`);
                await writer.write(encoder.encode("GET_CONFIG\n"));
                let configData = "";
                reader = port.readable.getReader();
                const timeoutMs = 1000;
                const startTime = Date.now();
                while (Date.now() - startTime < timeoutMs) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    configData += decoder.decode(value, { stream: true });
                    if (configData.includes("}")) {
                        try {
                            const cleaned = configData.replace(/[^\x20-\x7E{}\[\]":,.\r\n]/g, "").trim();
                            config = JSON.parse(cleaned);
                            break;
                        } catch (e) { }
                    }
                }
                reader.releaseLock();
                if (!config) {
                    await delay(300);
                    attempt++;
                }
            } catch (e) {
                attempt++;
                await delay(300);
            }
        }

        writer.releaseLock();

        if (!config) {
            throw new Error("Failed to receive valid JSON config after " + maxAttempts + " attempts.");
        }

        fillForm(config);
        isConnected = true;
        originalConfig = config;
        document.getElementById("fakeBtn").classList.add("hidden");
        const connectBtn = document.getElementById("connectBtn");
        let originalHeight = connectBtn.offsetHeight + "px";

        connectBtn.addEventListener("mouseenter", () => {
            if (connectBtn.classList.contains("btnconnected")) {
                connectBtn.innerText = "Disconnect?";
                connectBtn.style.backgroundColor = "red";
                connectBtn.style.cursor = "pointer";
                connectBtn.style.height = originalHeight;
            }
        });

        connectBtn.addEventListener("mouseleave", () => {
            if (isConnected) {
                connectBtn.innerText = "🔒 Connected to device";
                connectBtn.style.backgroundColor = "";
                connectBtn.style.cursor = "default";
                connectBtn.style.height = originalHeight;
            }
        });

        navigator.serial.addEventListener("disconnect", handleUsbDisconnect);


        document.getElementById("statusText").innerText =
            `✅ Connected to device. Firmware: ${config.firmwareVersion || "N/A"}`;
        document.getElementById("connectBtn").classList.remove("btnconnect");
        document.getElementById("connectBtn").classList.add("btnconnected");
        document.getElementById("connectBtn").onclick = null;
        document.getElementById("connectBtn").innerText = "🔒 Connected to device";
        document.getElementById("configForm").classList.remove("hidden");
        document.getElementById("connectBtn").onclick = async () => {
            if (isConnected) {
                await userDisconnect();
            }
        };


        Swal.fire({
            icon: "success",
            title: "Connected!",
            text: `Firmware: ${config.firmwareVersion || "Unknown"}`,
            timer: 2000,
            showConfirmButton: false
        });
    } catch (err) {
        if (reader) {
            try { await reader.cancel(); } catch (e) { }
            reader = null;
        }
        if (port) {
            try { await port.close(); } catch (e) { }
            port = null;
        }

        isConnected = false;

        Swal.fire({
            icon: "error",
            title: "Connection error",
            text: err.toString()
        });
        document.getElementById("statusText").innerText = "❌ Failed to connect.";
        document.getElementById("configForm").classList.add("hidden");
    }
}

function fillForm(cfg) {
    document.getElementById("ssid").value = cfg.ssid || "";
    document.getElementById("password").value = cfg.password || "";
    document.getElementById("appKey").value = cfg.appKey || "";
    document.getElementById("appSecret").value = cfg.appSecret || "";
    document.getElementById("deviceId").value = cfg.deviceId || "";
    document.getElementById("pcMac").value = cfg.pcMac || "";
    document.getElementById("wolMode").value = cfg.wolMode || "both";
    document.getElementById("enableLed").checked = cfg.enableLed || false;
    document.getElementById("enableBuzzer").checked = cfg.enableBuzzer || false;
}

async function sendConfig(event) {
    event.preventDefault();

    if (!isConnected || !port || !port.writable) {
        Swal.fire({
            icon: "warning",
            title: "Device not connected",
            text: "Please connect the device first. Also, nice try submitting a hidden form."
        });
        return;
    }
    document.getElementById("configForm").classList.add("form-disabled"); //disable form to prevent multiple submissions
    const currentForm = {
        ssid: document.getElementById("ssid").value.trim(),
        password: document.getElementById("password").value.trim(),
        appKey: document.getElementById("appKey").value.trim(),
        appSecret: document.getElementById("appSecret").value.trim(),
        deviceId: document.getElementById("deviceId").value.trim(),
        pcMac: document.getElementById("pcMac").value.trim(),
        wolMode: document.getElementById("wolMode").value,
        enableLed: document.getElementById("enableLed").checked,
        enableBuzzer: document.getElementById("enableBuzzer").checked
    };

    const configToSend = {};
    for (const key in currentForm) {
        if (currentForm[key] !== originalConfig[key]) {
            configToSend[key] = currentForm[key];
        }
    }
    if (Object.keys(configToSend).length === 0) {
        Swal.fire({
            icon: "info",
            title: "No Changes",
            text: "You didn’t change anything.",
            timer: 2000,
            showConfirmButton: false
        });
        return;
    }


    try {
        const jsonData = JSON.stringify(currentForm) + "\n";
        const writer = port.writable.getWriter();
        await writer.write(new TextEncoder().encode(jsonData));
        await writer.write(new TextEncoder().encode("RESTART\n"));
        writer.releaseLock();

        document.getElementById("statusText").innerText = "🔁 Sent config. Rebooting device...";

        Swal.fire({
            icon: "info",
            title: "Rebooting...",
            text: "Please wait while device reboots.",
            timer: 2500,
            showConfirmButton: false
        });

        await delay(5000);

        let retries = 0;
        let configData = "";
        let newConfig = null;
        const maxRetries = 10;

        while (retries < maxRetries) {
            try {
                const writer2 = port.writable.getWriter();
                await writer2.write(new TextEncoder().encode("GET_CONFIG\n"));
                writer2.releaseLock();

                configData = "";
                reader = port.readable.getReader();
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    configData += new TextDecoder().decode(value);
                    if (configData.includes("}")) break;
                }
                reader.releaseLock();

                newConfig = JSON.parse(configData.trim());
                break;
            } catch (err) {
                retries++;
                await delay(500);
            }
        }

        if (!newConfig) {
            Swal.fire({
                icon: "error",
                title: "❌ Failed to verify",
                text: "Device did not respond with valid config after reboot."
            });
            return;
        }

        const isMatch = compare(currentForm, newConfig);


        if (isMatch) {
            originalConfig = currentForm;
            Swal.fire({
                icon: "success",
                title: "✅ Successful",
                text: "Config saved and verified successfully!"
            });
            document.getElementById("configForm").classList.remove("form-disabled"); //enable form again
            document.getElementById("statusText").innerText =
                `✅ Connected to device. Firmware: ${newConfig.firmwareVersion || "N/A"}`;
            document.getElementById("connectBtn").classList.add("connected");
        } else {
            Swal.fire({
                icon: "warning",
                title: "⚠️ Config Mismatch",
                text: "Device config does not match after reboot."
            });
            document.getElementById("configForm").classList.remove("form-disabled");//enable form again
        }

    } catch (err) {
        console.error("Stack trace:\n" + err.stack);
        Swal.fire({
            icon: "error",
            title: "❌ Error",
            text: err.toString()
        });
    }
}
async function cleanupConnection() {
    isConnected = false;
    originalConfig = {};
    document.getElementById("fakeBtn").classList.remove("hidden");
    navigator.serial.removeEventListener("disconnect", handleUsbDisconnect);
    try {
        if (reader) {
            await reader.cancel().catch(() => { });
            reader.releaseLock?.();
            reader = null;
        }
    } catch (e) { }

    try {
        if (port) {
            await port.close().catch(() => { });
            port = null;
        }
    } catch (e) { }

    const connectBtn = document.getElementById("connectBtn");
    connectBtn.style.backgroundColor = "";
    connectBtn.style.cursor = "pointer";
    connectBtn.style.height = "";
    connectBtn.innerText = "🔌 Connect to Device";

    document.getElementById("statusText").innerText = "Not connected.";
    connectBtn.classList.remove("btnconnected");
    connectBtn.classList.add("btnconnect");
    connectBtn.onclick = connectDevice;

    document.getElementById("configForm").classList.add("hidden");
}

// Hàm gọi khi user nhấn nút disconnect
async function userDisconnect() {
    await cleanupConnection();
    Swal.fire({
        icon: "success",
        title: "Disconnected!",
        text: "Device disconnected successfully.",
        timer: 2000,
        showConfirmButton: false
    });
}

// Xử lý sự kiện disconnect do rút cổng
async function handleUsbDisconnect(event) {
    if (event.target === port) {
        console.warn("[USB] Disconnected by user");
        await cleanupConnection();
        Swal.fire({
            icon: "error",
            title: "Disconnected unexpectedly",
            text: "Device was disconnected. Please reconnect.",
        });
    }
}

function compare(a, b) {
    for (let key in a) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const realBtn = document.getElementById('realBtn');
const fakeBtn = document.getElementById('fakeBtn');

fakeBtn.addEventListener('click', () => {
    realBtn.shadowRoot.querySelector('button').click();
});

document.querySelectorAll(".toggle-password").forEach(function (toggle) {
    toggle.addEventListener("click", function () {
        const targetId = this.getAttribute("data-target");
        const input = document.getElementById(targetId);
        const type = input.getAttribute("type") === "password" ? "text" : "password";
        input.setAttribute("type", type);
        this.classList.toggle("fa-eye-slash");
    });
});
