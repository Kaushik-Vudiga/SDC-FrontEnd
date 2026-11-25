"use strict";

const PREDICTION_CONFIG = Object.freeze({
  endpoint: "https://olist-cancellation-api.onrender.com/predict",
  // Render instances may need time to wake after inactivity.
  timeoutMs: 90000,
  probabilityThresholds: Object.freeze({ lowMax: 0.35, moderateMax: 0.65 })
});

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("prediction-form");
  if (!form) return;

  const fields = {
    date: document.getElementById("purchase-date"),
    hour: document.getElementById("purchase-hour"),
    state: document.getElementById("customer-state"),
    city: document.getElementById("customer-city")
  };
  const predictButton = document.getElementById("predict-button");
  const resetButton = document.getElementById("reset-button");
  const retryButton = document.getElementById("try-again-button");
  const formMessage = document.getElementById("form-message");
  const modelStatus = document.querySelector(".model-status");
  const states = {
    empty: document.getElementById("result-empty"),
    loading: document.getElementById("result-loading"),
    success: document.getElementById("result-success"),
    error: document.getElementById("result-error")
  };

  const showResultState = (stateName) => {
    Object.entries(states).forEach(([name, element]) => {
      element.hidden = name !== stateName;
    });
    modelStatus.lastChild.textContent = stateName === "success" ? " API connected" :
      stateName === "loading" ? " Contacting API" :
      stateName === "error" ? " API unavailable" : " API not checked";
  };

  showResultState("empty");

  const setFieldError = (input, message) => {
    const field = input.closest(".field");
    const error = document.getElementById(`${input.id}-error`);
    field.classList.toggle("invalid", Boolean(message));
    input.setAttribute("aria-invalid", String(Boolean(message)));
    if (error) error.textContent = message;
  };

  const validate = () => {
    let valid = true;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const year = fields.date.value ? Number(fields.date.value.slice(0, 4)) : NaN;
    const hour = Number(fields.hour.value);
    const city = fields.city.value.trim();

    if (!fields.date.value) {
      setFieldError(fields.date, "Choose the order's purchase date."); valid = false;
    } else if (!datePattern.test(fields.date.value) || !fields.date.validity.valid || year < 2000 || year > 2100) {
      setFieldError(fields.date, "Use a valid date between 2000 and 2100."); valid = false;
    } else setFieldError(fields.date, "");

    if (fields.hour.value === "") {
      setFieldError(fields.hour, "Enter the purchase hour."); valid = false;
    } else if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      setFieldError(fields.hour, "Hour must be a whole number from 0 to 23."); valid = false;
    } else setFieldError(fields.hour, "");

    if (!fields.state.value) {
      setFieldError(fields.state, "Select the customer's state."); valid = false;
    } else setFieldError(fields.state, "");

    if (!city) {
      setFieldError(fields.city, "Enter the customer's city."); valid = false;
    } else if (city.length < 2 || city.length > 100) {
      setFieldError(fields.city, "City must contain between 2 and 100 characters."); valid = false;
    } else setFieldError(fields.city, "");

    formMessage.hidden = valid;
    formMessage.textContent = valid ? "" : "Please review the highlighted fields before continuing.";
    return valid;
  };

  // Centralized adapter from the user-friendly form to the API's OrderData schema.
  const buildRequestBody = () => {
    const [year, month, day] = fields.date.value.split("-").map(Number);
    const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const mondayBasedWeekday = (utcDay + 6) % 7;
    return {
      purchase_year: year,
      purchase_month: month,
      purchase_day: day,
      purchase_hour: Number(fields.hour.value),
      purchase_dayofweek: mondayBasedWeekday,
      customer_state: fields.state.value,
      customer_city: fields.city.value.trim().toLowerCase()
    };
  };

  const setLoading = (loading) => {
    predictButton.disabled = loading;
    resetButton.disabled = loading;
    predictButton.classList.toggle("loading", loading);
    predictButton.querySelector(".button-label").textContent = loading ? "Analyzing order" : "Analyze cancellation risk";
  };

  const getApiErrorMessage = (response, data) => {
    if (response.status === 422) {
      const details = Array.isArray(data?.detail)
        ? data.detail.map((item) => item?.msg).filter((message) => typeof message === "string").join("; ")
        : "";
      return details ? `The API rejected the order details: ${details}` : "The API rejected the order details (HTTP 422). Check the fields and try again.";
    }
    if (response.status === 404) return "The prediction endpoint was not found (HTTP 404). Check the API deployment.";
    if (response.status === 503) return "The prediction service is temporarily unavailable (HTTP 503). Please try again shortly.";
    if (response.status >= 500) return `The prediction service reported a server error (HTTP ${response.status}). Please try again later.`;
    return `The prediction request failed (HTTP ${response.status}). Please try again.`;
  };

  const normalizeResponse = (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("UNEXPECTED_RESPONSE");
    const rawPrediction = data.cancellation_prediction;
    const probability = data.cancellation_probability;
    const hasPrediction = rawPrediction === 0 || rawPrediction === 1 || rawPrediction === "0" || rawPrediction === "1";
    const hasProbability = typeof probability === "number" && Number.isFinite(probability) && probability >= 0 && probability <= 1;
    if (!hasPrediction || !hasProbability) throw new Error("UNEXPECTED_RESPONSE");
    return {
      canceled: Number(rawPrediction) === 1,
      probability,
      status: typeof data.status === "string" && data.status.trim() ? data.status.trim() : (Number(rawPrediction) === 1 ? "Canceled" : "Not Canceled")
    };
  };

  const renderPrediction = (result) => {
    const percent = Math.round(result.probability * 1000) / 10;
    const thresholds = PREDICTION_CONFIG.probabilityThresholds;
    const riskLevel = result.probability < thresholds.lowMax ? "low" : result.probability < thresholds.moderateMax ? "moderate" : "high";
    const labels = { low: "Low risk", moderate: "Moderate risk", high: "High risk" };
    const status = document.getElementById("result-status");
    const summary = document.getElementById("result-summary");
    const pill = document.getElementById("result-pill");
    const symbol = document.getElementById("result-symbol");
    const probabilityValue = document.getElementById("probability-value");
    const probabilityTrack = document.getElementById("probability-track");
    const probabilityBar = document.getElementById("probability-bar");

    states.success.classList.remove("low", "moderate", "high");
    states.success.classList.add(riskLevel);
    status.textContent = result.status;
    summary.textContent = result.canceled ? "The model predicts this order will be canceled." : "The model predicts this order will not be canceled.";
    pill.textContent = labels[riskLevel];
    symbol.textContent = result.canceled ? "!" : "✓";
    probabilityValue.textContent = `${percent}%`;
    probabilityTrack.setAttribute("aria-valuenow", String(percent));
    probabilityTrack.setAttribute("aria-valuetext", `${percent}% cancellation probability`);
    probabilityBar.style.width = "0%";
    showResultState("success");
    requestAnimationFrame(() => { probabilityBar.style.width = `${percent}%`; });
  };

  const renderError = (message) => {
    document.getElementById("result-error-message").textContent = message;
    showResultState("error");
  };

  // A no-cors health probe can show that the host is reachable, but its opaque
  // response cannot prove that the prediction endpoint succeeded.
  const diagnoseConnection = async () => {
    if (!navigator.onLine) return "Your browser appears to be offline. Reconnect and try again.";
    try {
      await fetch("https://olist-cancellation-api.onrender.com/health", {
        mode: "no-cors",
        signal: AbortSignal.timeout(8000)
      });
      return "The API host is reachable, but the browser could not access the prediction response. This is likely a CORS restriction. Ask the API owner to allow this page's origin and the JSON POST preflight.";
    } catch (probeError) {
      console.warn("Prediction API health probe failed", { name: probeError.name, origin: location.origin });
      return "Could not connect to the prediction service. Check your internet connection and try again later.";
    }
  };

  const submitPrediction = async () => {
    if (!validate()) {
      const firstInvalid = form.querySelector('[aria-invalid="true"]');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    setLoading(true);
    showResultState("loading");
    formMessage.hidden = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), PREDICTION_CONFIG.timeoutMs);

    try {
      const response = await fetch(PREDICTION_CONFIG.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(buildRequestBody()),
        signal: controller.signal
      });
      let data;
      try { data = await response.json(); } catch { data = null; }
      if (!response.ok) {
        console.error("Prediction API returned an HTTP error", { status: response.status, endpoint: PREDICTION_CONFIG.endpoint });
        throw new Error(getApiErrorMessage(response, data));
      }
      renderPrediction(normalizeResponse(data));
    } catch (error) {
      console.error("Prediction request failed", { name: error.name, message: error.message, origin: location.origin });
      if (error.name === "AbortError") {
        renderError("The prediction request timed out after 90 seconds. The service may be waking up—please try again.");
      } else if (error.message === "UNEXPECTED_RESPONSE") {
        renderError("The service returned an unexpected response, so no prediction was displayed.");
      } else if (error instanceof TypeError) {
        renderError(await diagnoseConnection());
      } else {
        renderError(error.message || "We could not complete the prediction request.");
      }
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  };

  form.addEventListener("submit", (event) => { event.preventDefault(); submitPrediction(); });
  form.addEventListener("reset", () => {
    window.setTimeout(() => {
      Object.values(fields).forEach((input) => setFieldError(input, ""));
      formMessage.hidden = true;
      showResultState("empty");
    }, 0);
  });
  retryButton.addEventListener("click", submitPrediction);
  Object.values(fields).forEach((input) => {
    input.addEventListener("input", () => {
      if (input.getAttribute("aria-invalid") === "true") validate();
    });
  });
});
