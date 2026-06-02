(function () {
  const ui = {
    brokerUrl: document.getElementById("brokerUrl"),
    topicInput: document.getElementById("topicInput"),
    clientIdInput: document.getElementById("clientIdInput"),
    connectBtn: document.getElementById("connectBtn"),
    disconnectBtn: document.getElementById("disconnectBtn"),
    mqttStatus: document.getElementById("mqttStatus"),
    lastReport: document.getElementById("lastReport"),
    decodeStatus: document.getElementById("decodeStatus"),
    deviceIdValue: document.getElementById("deviceIdValue"),
    reportTypeValue: document.getElementById("reportTypeValue"),
    batteryVisual: document.getElementById("batteryVisual"),
    batteryFill: document.getElementById("batteryFill"),
    batteryPercent: document.getElementById("batteryPercent"),
    batteryVoltage: document.getElementById("batteryVoltage"),
    batteryChargeState: document.getElementById("batteryChargeState"),
    batterySource: document.getElementById("batterySource"),
    batteryInterval: document.getElementById("batteryInterval"),
    locationInterval: document.getElementById("locationInterval"),
    powerMode: document.getElementById("powerMode"),
    gnssFix: document.getElementById("gnssFix"),
    locationSource: document.getElementById("locationSource"),
    locationStale: document.getElementById("locationStale"),
    satelliteCount: document.getElementById("satelliteCount"),
    hdopValue: document.getElementById("hdopValue"),
    accuracyValue: document.getElementById("accuracyValue"),
    latLngText: document.getElementById("latLngText"),
    motionState: document.getElementById("motionState"),
    imuTilt: document.getElementById("imuTilt"),
    imuVector: document.getElementById("imuVector"),
    collarModel: document.getElementById("collarModel"),
    audioDecodeState: document.getElementById("audioDecodeState"),
    audioClip: document.getElementById("audioClip"),
    audioSegments: document.getElementById("audioSegments"),
    audioCodec: document.getElementById("audioCodec"),
    audioBytes: document.getElementById("audioBytes"),
    audioList: document.getElementById("audioList"),
    eventLog: document.getElementById("eventLog"),
    rawPayload: document.getElementById("rawPayload"),
  };

  const state = {
    client: null,
    map: null,
    marker: null,
    trail: null,
    points: [],
    decoded: new Set(),
    ffmpeg: false,
  };

  ui.clientIdInput.value = "pet-local-view-" + Math.random().toString(16).slice(2, 10);

  initMap();
  checkDecodeSupport();

  ui.connectBtn.addEventListener("click", connectMqtt);
  ui.disconnectBtn.addEventListener("click", disconnectMqtt);

  function initMap() {
    state.map = L.map("map", { zoomControl: true }).setView([31.2304, 121.4737], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(state.map);
    state.marker = L.circleMarker([31.2304, 121.4737], {
      radius: 9,
      color: "#f6b15f",
      weight: 2,
      fillColor: "#fff0bf",
      fillOpacity: 0.95,
    }).addTo(state.map);
    state.trail = L.polyline([], { color: "#48d2c9", weight: 4, opacity: 0.85 }).addTo(state.map);
  }

  async function checkDecodeSupport() {
    try {
      const resp = await fetch("/api/status");
      const data = await resp.json();
      state.ffmpeg = Boolean(data.ffmpeg);
      setPill(ui.decodeStatus, state.ffmpeg ? "音频可解码" : "未检测到 ffmpeg", state.ffmpeg ? "ok" : "warn");
    } catch (e) {
      setPill(ui.decodeStatus, "离线页面：仅显示 AMR", "warn");
    }
  }

  function connectMqtt() {
    disconnectMqtt();
    const url = ui.brokerUrl.value.trim();
    const topic = ui.topicInput.value.trim() || "DEVICE_REPORT/+";
    const clientId = ui.clientIdInput.value.trim() || ("pet-local-view-" + Date.now());

    setPill(ui.mqttStatus, "MQTT 连接中", "warn");
    pushLog("connect", url + " / " + topic);

    state.client = mqtt.connect(url, {
      clientId,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 3000,
      keepalive: 60,
    });

    state.client.on("connect", function () {
      setPill(ui.mqttStatus, "MQTT 已连接", "ok");
      state.client.subscribe(topic, { qos: 0 }, function (err) {
        if (err) {
          setPill(ui.mqttStatus, "订阅失败", "error");
          pushLog("subscribe failed", String(err));
        } else {
          pushLog("subscribed", topic);
        }
      });
    });

    state.client.on("reconnect", function () {
      setPill(ui.mqttStatus, "MQTT 重连中", "warn");
    });

    state.client.on("close", function () {
      setPill(ui.mqttStatus, "MQTT 已断开", "muted");
    });

    state.client.on("error", function (err) {
      setPill(ui.mqttStatus, "MQTT 错误", "error");
      pushLog("mqtt error", err.message || String(err));
    });

    state.client.on("message", function (topicName, payload) {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        renderMessage(topicName, msg);
      } catch (e) {
        pushLog("JSON 解析失败", e.message || String(e));
      }
    });
  }

  function disconnectMqtt() {
    if (state.client) {
      try {
        state.client.end(true);
      } catch (e) {
        // ignore close errors from reconnecting sockets
      }
      state.client = null;
    }
  }

  function renderMessage(topicName, msg) {
    ui.rawPayload.textContent = JSON.stringify(msg, null, 2);
    ui.lastReport.textContent = "最后上报 " + new Date().toLocaleTimeString();
    ui.deviceIdValue.textContent = msg.device_id || "--";
    ui.reportTypeValue.textContent = msg.report_type || "--";
    pushLog(msg.report_type || "message", topicName);

    const status = msg.status || {};
    ui.locationInterval.textContent = withUnit(msg.report_interval_s || status.report_interval_s, "s");
    ui.powerMode.textContent = status.power_mode || "--";

    if (msg.battery) {
      renderBattery(msg.battery, msg.battery_interval_s || status.battery_interval_s);
    }
    if (msg.gnss) {
      renderGnss(msg.gnss);
    }
    if (msg.imu) {
      renderImu(msg.imu);
    }
    if (msg.report_type === "audio" || msg.audio) {
      renderAudio(msg);
    }
  }

  function renderBattery(battery, interval) {
    const charging = battery.charging === true || battery.status === "charging";
    const rawPercent = Number(battery.percent);
    const percent = charging ? NaN : clamp(rawPercent, 0, 100);
    const hasPercent = Number.isFinite(percent);

    ui.batteryPercent.textContent = charging ? "充电中" : (hasPercent ? Math.round(percent) + "%" : "--%");
    ui.batteryFill.style.width = charging ? "100%" : ((hasPercent ? percent : 0) + "%");
    ui.batteryVisual.classList.toggle("low", !charging && hasPercent && percent < 20);
    ui.batteryVisual.classList.toggle("charging", charging);
    ui.batteryVoltage.textContent = valueOrDash(battery.voltage_mv, " mV");
    ui.batteryChargeState.textContent = charging ? "外接电源 / 充电中" : (battery.status === "ok" ? "电池供电" : (battery.status || "--"));
    ui.batterySource.textContent = battery.source || "--";
    ui.batteryInterval.textContent = withUnit(interval, "s");
  }

  function renderGnss(gnss) {
    ui.gnssFix.textContent = gnss.status || (gnss.valid ? "fixed" : "not_fixed");
    if (ui.locationSource) ui.locationSource.textContent = gnss.source || "--";
    if (ui.locationStale) ui.locationStale.textContent = gnss.stale ? "last known" : "实时";
    ui.satelliteCount.textContent = valueOrDash(gnss.satellites_num);
    ui.hdopValue.textContent = valueOrDash(gnss.hdop);
    if (ui.accuracyValue) ui.accuracyValue.textContent = valueOrDash(gnss.accuracy_m, " m");

    const lat = Number(gnss.latitude);
    const lon = Number(gnss.longitude);
    if (gnss.valid && Number.isFinite(lat) && Number.isFinite(lon)) {
      ui.latLngText.textContent = lat.toFixed(6) + ", " + lon.toFixed(6);
      state.marker.setStyle({
        color: gnss.source === "cellloc" ? "#ffb65f" : "#56d7cd",
        fillColor: gnss.stale ? "#ff6c7b" : (gnss.source === "cellloc" ? "#ffe39b" : "#bffff8"),
      });
      state.marker.setLatLng([lat, lon]);
      state.points.push([lat, lon]);
      if (state.points.length > 160) state.points.shift();
      state.trail.setLatLngs(state.points);
      state.map.panTo([lat, lon], { animate: true, duration: 0.5 });
    }
  }

  function renderImu(imu) {
    ui.motionState.textContent = imu.motion_state || imu.status || "unknown";
    if (!imu.valid) {
      ui.imuVector.textContent = "X -- / Y -- / Z --";
      ui.imuTilt.textContent = "--";
      ui.collarModel.style.transform = "rotateX(0deg) rotateY(0deg) rotateZ(0deg)";
      return;
    }

    const x = Number(imu.acc_x_g || 0);
    const y = Number(imu.acc_y_g || 0);
    const z = Number(imu.acc_z_g || 0);
    ui.imuVector.textContent = "X " + x.toFixed(3) + " / Y " + y.toFixed(3) + " / Z " + z.toFixed(3);

    const pitch = radToDeg(Math.atan2(-x, Math.sqrt(y * y + z * z)));
    const roll = radToDeg(Math.atan2(y, z || 0.0001));
    ui.imuTilt.textContent = Math.round(pitch) + "deg / " + Math.round(roll) + "deg";
    ui.collarModel.style.transform =
      "rotateX(" + (pitch * 0.75).toFixed(1) + "deg) " +
      "rotateY(" + (-roll * 0.75).toFixed(1) + "deg) " +
      "rotateZ(" + (-roll * 0.1).toFixed(1) + "deg)";
  }

  function renderAudio(msg) {
    const audio = msg.audio || {};
    const files = normalizeAudioFiles(audio);
    const clipId = audio.clip_id || audio.clip || "--";
    const totalBytes = files.reduce((sum, item) => sum + Number(item.bytes || estimateBase64Bytes(item.payload_b64)), 0);
    const mergedFile = mergeAudioFiles(files, audio);

    ui.audioClip.textContent = clipId;
    ui.audioSegments.textContent = String(files.length || "--");
    ui.audioCodec.textContent = audio.codec || (files[0] && files[0].codec) || "--";
    ui.audioBytes.textContent = mergedFile ? formatBytes(mergedFile.bytes) : (totalBytes ? formatBytes(totalBytes) : "--");

    if (!files.length) {
      return;
    }

    const card = document.createElement("div");
    card.className = "audio-card";
    card.innerHTML =
      "<div class='audio-card-head'>" +
      "<strong>clip " + escapeHtml(clipId) + "</strong>" +
      "<span>" + files.length + " 段合并 / " + formatBytes(mergedFile.bytes) + "</span>" +
      "</div>";

    const merged = document.createElement("div");
    merged.className = "audio-item merged";
    const mergedKey = [
      msg.device_id || "device",
      audio.clip_id || audio.clip || "clip",
      "merged",
      mergedFile.bytes,
    ].join("-");
    merged.innerHTML =
      "<div>" +
      "<strong>整段合并音频</strong>" +
      "<span>AMR-NB merged / " + files.length + " 段 / " + formatBytes(mergedFile.bytes) + "</span>" +
      "</div>" +
      "<div class='audio-actions'>" +
      "<button class='primary decode-btn'>解码播放整段</button>" +
      "<a class='ghost link-btn' download='clip_" + escapeHtml(clipId) + "_merged.amr'>下载合并 AMR</a>" +
      "</div>" +
      "<div class='player-slot'></div>";
    merged.querySelector("a").href = "data:audio/amr;base64," + mergedFile.payload_b64;
    merged.querySelector(".decode-btn").addEventListener("click", function () {
      decodeAudio(mergedFile, merged.querySelector(".player-slot"), mergedKey);
    });
    card.appendChild(merged);
    if (state.ffmpeg && !state.decoded.has(mergedKey)) {
      decodeAudio(mergedFile, merged.querySelector(".player-slot"), mergedKey);
    }

    files.forEach((file, index) => {
      const item = document.createElement("div");
      item.className = "audio-item";
      const key = [
        msg.device_id || "device",
        audio.clip_id || audio.clip || "clip",
        file.clip_index || file.segment_index || index + 1,
        file.bytes || estimateBase64Bytes(file.payload_b64),
      ].join("-");
      item.innerHTML =
        "<div>" +
        "<strong>segment " + escapeHtml(file.clip_index || file.segment_index || index + 1) + "</strong>" +
        "<span>" + escapeHtml(file.codec || audio.codec || "amrnb") + " / " + formatBytes(file.bytes || estimateBase64Bytes(file.payload_b64)) + "</span>" +
        "</div>" +
        "<div class='audio-actions'>" +
        "<button class='ghost decode-btn'>单段播放</button>" +
        "<a class='ghost link-btn' download='clip_" + escapeHtml(clipId) + "_" + (index + 1) + ".amr'>下载 AMR</a>" +
        "</div>" +
        "<div class='player-slot'></div>";
      const download = item.querySelector("a");
      download.href = "data:audio/amr;base64," + (file.payload_b64 || "");
      item.querySelector(".decode-btn").addEventListener("click", function () {
        decodeAudio(file, item.querySelector(".player-slot"), key);
      });
      card.appendChild(item);
    });

    ui.audioList.prepend(card);
    while (ui.audioList.children.length > 8) {
      ui.audioList.removeChild(ui.audioList.lastChild);
    }
  }

  function normalizeAudioFiles(audio) {
    if (Array.isArray(audio.files)) {
      return audio.files.map((item) => ({
        codec: item.codec || audio.codec || "amrnb",
        clip_index: item.clip_index,
        segment_index: item.segment_index,
        bytes: item.bytes,
        payload_b64: item.payload_b64 || item.data_b64,
      })).filter((item) => item.payload_b64);
    }
    if (audio.payload_b64 || audio.data_b64) {
      return [{
        codec: audio.codec || "amrnb",
        clip_index: audio.clip_index || audio.segment_index || 1,
        bytes: audio.bytes,
        payload_b64: audio.payload_b64 || audio.data_b64,
      }];
    }
    return [];
  }

  function mergeAudioFiles(files, audio) {
    const parts = files
      .filter((file) => file.payload_b64)
      .map((file, index) => stripAmrHeader(base64ToBytes(file.payload_b64), index > 0));
    const mergedBytes = concatBytes(parts);
    return {
      codec: audio.codec || (files[0] && files[0].codec) || "amrnb",
      clip_index: "merged",
      bytes: mergedBytes.length,
      payload_b64: bytesToBase64(mergedBytes),
    };
  }

  function stripAmrHeader(bytes, mustStrip) {
    const header = [35, 33, 65, 77, 82, 10]; // "#!AMR\n"
    let hasHeader = bytes.length >= header.length;
    for (let i = 0; i < header.length && hasHeader; i += 1) {
      hasHeader = bytes[i] === header[i];
    }
    if (mustStrip && hasHeader) {
      return bytes.slice(header.length);
    }
    if (!mustStrip && !hasHeader) {
      const out = new Uint8Array(header.length + bytes.length);
      out.set(header, 0);
      out.set(bytes, header.length);
      return out;
    }
    return bytes;
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    parts.forEach((part) => {
      out.set(part, offset);
      offset += part.length;
    });
    return out;
  }

  function base64ToBytes(b64) {
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      out[i] = raw.charCodeAt(i);
    }
    return out;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function decodeAudio(file, slot, key) {
    if (!file.payload_b64) {
      slot.textContent = "没有音频 payload";
      return;
    }
    slot.textContent = "解码中...";
    try {
      const resp = await fetch("/api/audio/decode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codec: file.codec || "amrnb", payload_b64: file.payload_b64 }),
      });
      const data = await resp.json();
      if (!data.ok) {
        slot.innerHTML = "<span class='warn-text'>无法直接播放：" + escapeHtml(data.error || "decode failed") + "</span>";
        return;
      }
      state.decoded.add(key);
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = "data:" + data.mime + ";base64," + data.wav_b64;
      slot.innerHTML = "";
      slot.appendChild(audio);
      ui.audioDecodeState.textContent = "最近音频已解码";
    } catch (e) {
      slot.innerHTML = "<span class='warn-text'>解码接口不可用，可先下载 AMR 文件。</span>";
    }
  }

  function setPill(el, text, kind) {
    el.textContent = text;
    el.className = "status-pill";
    if (kind === "ok") el.classList.add("ok");
    else if (kind === "error") el.classList.add("error");
    else if (kind === "warn") el.classList.add("warn");
    else el.classList.add("muted");
  }

  function pushLog(title, text) {
    const row = document.createElement("div");
    row.className = "event-row";
    row.innerHTML =
      "<strong>" + escapeHtml(title) + "</strong>" +
      "<span>" + escapeHtml(text || "") + "</span>" +
      "<em>" + new Date().toLocaleTimeString() + "</em>";
    ui.eventLog.prepend(row);
    while (ui.eventLog.children.length > 36) {
      ui.eventLog.removeChild(ui.eventLog.lastChild);
    }
  }

  function valueOrDash(value, suffix) {
    if (value === undefined || value === null || value === "") return "--";
    return String(value) + (suffix || "");
  }

  function withUnit(value, unit) {
    if (value === undefined || value === null || value === "") return "--";
    return String(value) + " " + unit;
  }

  function formatBytes(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return "--";
    if (n < 1024) return n + " B";
    return (n / 1024).toFixed(1) + " KB";
  }

  function estimateBase64Bytes(b64) {
    if (!b64) return 0;
    return Math.floor((b64.length * 3) / 4);
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return NaN;
    return Math.max(min, Math.min(max, value));
  }

  function radToDeg(rad) {
    return rad * 180 / Math.PI;
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
})();
