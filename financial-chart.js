(() => {
  "use strict";
  const ACTUAL = "#159a74",
    EXPECTED = "#2671d9",
    COLORS = ["#2671d9", "#d88416", "#7657c9", "#db5f76", "#159a74", "#5d8fbd"];
  let api = null,
    hitTargets = [],
    hiddenGroups = new Set();
  const compact = (value) => {
    if (!Number.isFinite(value)) return "—";
    const sign = value < 0 ? "-" : "";
    const n = Math.abs(value);
    if (n >= 1e9)
      return sign + "TTD " + (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + "B";
    if (n >= 1e6)
      return sign + "TTD " + (n / 1e6).toFixed(n >= 1e7 ? 0 : 2) + "M";
    if (n >= 1e3)
      return sign + "TTD " + (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "K";
    return sign + "TTD " + Math.round(n);
  };
  const full = (value) =>
    Number.isFinite(value)
      ? "TTD " +
        new Intl.NumberFormat("en-TT", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(value)
      : "Incomplete pricing";
  function initialize(options) {
    api = options;
    $("previousMonths").onclick = () => scroll(-1);
    $("nextMonths").onclick = () => scroll(1);
    render();
    $("chartScroll").addEventListener("scroll", updateViewport);
    $("trendChart").addEventListener("pointermove", pointer);
    $("trendChart").addEventListener("pointerleave", () => $("chartTooltip").style.display = "none");
    render();
  }
  function $(id) {
    return id[0] === "."
      ? document.querySelector(id)
      : document.getElementById(id);
  }
  function scroll(direction) {
    const scroll = $("chartScroll"),
      step = Math.max(120, scroll.clientWidth / 6) * 6;
    scroll.scrollBy({ left: direction * step, behavior: "smooth" });
  }
  function updateButtons() {
    const s = $("chartScroll");
    $("previousMonths").disabled = s.scrollLeft < 4;
    $("nextMonths").disabled =
      s.scrollLeft + s.clientWidth >= s.scrollWidth - 4;
    if (api) updatePeriod();
  }
  function resizeCanvas(canvas, width, height) {
    const d = window.devicePixelRatio || 1;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.width = Math.round(width * d);
    canvas.height = Math.round(height * d);
    const c = canvas.getContext("2d");
    c.setTransform(d, 0, 0, d, 0, 0);
    return c;
  }
  function render() {
    if (!api || !$("trendChart")) return;
    const scroll = $("chartScroll"),
      plot = $(".chart-plot"),
      width = Math.max(720, (scroll.clientWidth / 6) * api.state.months.length),
      height = 420;
    plot.style.width = width + "px";
    const canvas = $("trendChart"),
      ctx = resizeCanvas(canvas, width, height),
      axis = resizeCanvas($("trendYAxis"), 72, height),
      series = api.getSeries(),
      max = api.getScale(series),
      pad = { l: 50, r: 18, t: 18, b: 42 },
      plotWidth = width - pad.l - pad.r,
      plotHeight = height - pad.t - pad.b,
      monthWidth = plotWidth / api.state.months.length;
    const chartMax = Math.max(1, ...series.operationalCosts, ...series.paymentCashOutflows, ...series.actualRevenue, ...(series.expectedComplete ? series.completeExpectedRevenue : series.configuredPricingRevenue)) * 1.12;
    hitTargets = [];
    ctx.clearRect(0, 0, width, height);
    axis.clearRect(0, 0, 72, height);
    drawGrid(ctx, axis, chartMax, pad, plotWidth, plotHeight);
    drawArea(ctx, series, chartMax, pad, plotWidth, plotHeight);
    if (api.state.mode === "cashflow") drawBars(ctx, series, series.groups, chartMax, pad, plotWidth, plotHeight, monthWidth);
    drawLines(ctx, series, chartMax, pad, plotWidth, plotHeight);
    drawLabels(ctx, series, chartMax, pad, plotWidth, plotHeight);
    updateControls(series);
    updateViewport();
  }
  function yFor(value, max, pad, h) {
    return pad.t + h - ((Number(value) || 0) / max) * h;
  }
  function xFor(i, pad, w, n) {
    return pad.l + (w * (i + 0.5)) / n;
  }
  function updateControls(series) {
    const complete = series.expectedComplete;
    const label = complete ? "Expected Revenue" : "Configured Revenue — Incomplete";
    $("expectedToggle").textContent = (api.state.showExpected ? "✓ " : "○ ") + label;
    $("actualToggle").textContent = (api.state.showActual ? "✓ " : "○ ") + "Actual Revenue";
    $("expectedToggle").setAttribute("aria-pressed", String(api.state.showExpected));
    $("actualToggle").setAttribute("aria-pressed", String(api.state.showActual));
    $("legend").innerHTML = '<span style="color:#159a74">Actual Revenue</span><span style="color:' + (complete ? "#2671d9" : "#d88416") + '">' + label + "</span>";
    $("chartExplanation").textContent = api.state.mode === "cashflow" ? "Stacked bars show when payments are scheduled to leave the business. Revenue remains shown monthly so payment timing can be compared with recurring revenue." : "The blue operational-cost line shows the monthly cost of operating the business. The green area shows actual monthly client revenue. The " + (complete ? "blue area shows complete expected revenue based on module pricing." : "amber area includes configured module rates only. It is not the complete expected revenue.");
  }
  function updateViewport() {
    const box = $("chartScroll"), monthWidth = Math.max(120, box.clientWidth / 6), first = Math.min(api.state.months.length - 1, Math.floor(box.scrollLeft / monthWidth)), last = Math.min(api.state.months.length - 1, first + 5), months = api.state.months.slice(first, last + 1), series = api.getSeries(), average = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), cost = series.operationalCosts.slice(first, last + 1), actual = series.actualRevenue.slice(first, last + 1);
    $("visiblePeriod").textContent = "Showing " + months[0].toLocaleDateString("en-TT", { month: "long", year: "numeric" }) + " – " + months[months.length - 1].toLocaleDateString("en-TT", { month: "long", year: "numeric" });
    $("visibleInsight").textContent = "Average cost " + full(average(cost)) + " · Actual revenue " + full(average(actual)) + " · Result " + full(average(actual) - average(cost)) + " · Coverage " + (average(cost) ? (average(actual) / average(cost) * 100).toFixed(1) : "0.0") + "% · Pricing " + (series.expectedComplete ? "Complete" : series.configuredModuleCount + " of " + series.requiredModuleCount + " modules");
    updateButtons();
  }
  function pointer(event) { const chart = $("trendChart"), tip = $("chartTooltip"), plot = $(".chart-plot"); if (!chart || !tip || !plot || !api) return; const rect = chart.getBoundingClientRect(), scale = chart.width / rect.width, px = (event.clientX - rect.left) * scale, py = (event.clientY - rect.top) * scale, target = hitTargets.slice().reverse().find(item => item.radius ? Math.hypot(item.x - px, item.y - py) <= item.radius : px >= item.x && px <= item.x + item.width && py >= item.y && py <= item.y + item.height); if (!target) return tip.style.display = "none"; const series = api.getSeries(), index = target.monthIndex, expected = series.expectedComplete ? series.completeExpectedRevenue[index] : series.configuredPricingRevenue[index]; tip.innerHTML = "<strong>" + series.months[index].toLocaleDateString("en-TT", { month: "long", year: "numeric" }) + "</strong><div>Operational Cost: " + full(series.operationalCosts[index]) + "</div><div>Actual Revenue: " + full(series.actualRevenue[index]) + "</div><div>" + (series.expectedComplete ? "Expected Revenue" : "Configured Pricing Revenue") + ": " + full(expected) + "</div><div>" + (series.expectedComplete ? "Actual Profit: " + full(series.actualRevenue[index] - series.operationalCosts[index]) : "Expected Revenue: Incomplete<br>Pricing Coverage: " + series.configuredModuleCount + " of " + series.requiredModuleCount + " modules<br>Missing Modules: " + series.missingModules.join(", ")) + (target.type === "cost-segment" ? "<div>Cost group: " + target.group + "<br>Value: " + full(target.value) + "</div>" : ""); tip.style.display = "block"; tip.style.left = Math.max(6, event.clientX - plot.getBoundingClientRect().left + 12) + "px"; tip.style.top = Math.max(6, event.clientY - plot.getBoundingClientRect().top - tip.offsetHeight - 12) + "px"; }
  function drawGrid(ctx, axis, max, pad, w, h) {
    ctx.strokeStyle = "#dce3ed";
    ctx.fillStyle = "#68758a";
    ctx.font = "11px system-ui";
    for (let i = 0; i < 6; i++) {
      const y = pad.t + (h * i) / 5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      axis.fillText(compact(max * (1 - i / 5)), 4, y + 4);
    }
    if ($("chartAxisCaption")) $("chartAxisCaption").textContent = "TTD per month";
  }
  function drawArea(ctx, s, max, pad, w, h) {
    const revenue = s.expectedComplete ? s.completeExpectedRevenue : s.configuredPricingRevenue;
    const areas = api.state.mode === "operational" ? [[s.operationalCosts, "#2671d9", "rgba(38,113,217,.10)"]] : [];
    areas.push([s.actualRevenue, ACTUAL, "rgba(21,154,116,.12)"], [revenue, s.expectedComplete ? "#2671d9" : "#d88416", s.expectedComplete ? "rgba(38,113,217,.10)" : "rgba(216,132,22,.10)"]);
    areas.forEach(([values, color, fill]) => {
      ctx.beginPath();
      values.forEach((value, i) => i ? ctx.lineTo(xFor(i, pad, w, values.length), yFor(value, max, pad, h)) : ctx.moveTo(xFor(i, pad, w, values.length), yFor(value, max, pad, h)));
      ctx.lineTo(xFor(values.length - 1, pad, w, values.length), pad.t + h);
      ctx.lineTo(pad.l, pad.t + h);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    });
  }
  function drawBars(ctx, s, groups, max, pad, w, h, mw) {
    groups.forEach((group, j) =>
      s.months.forEach((_, i) => {
        const value = s.groupValues[group][i] || 0,
          prior = groups
            .slice(0, j)
            .reduce((sum, g) => sum + (s.groupValues[g][i] || 0), 0),
          top = yFor(prior + value, max, pad, h),
          bottom = yFor(prior, max, pad, h);
        ctx.fillStyle = COLORS[j % COLORS.length];
        ctx.fillRect(
          pad.l + mw * i + 5,
          top,
          Math.max(2, mw - 10),
          bottom - top,
        );
        hitTargets.push({
          type: "cost-segment",
          monthIndex: i,
          x: pad.l + mw * i + 5,
          y: top,
          width: Math.max(2, mw - 10),
          height: bottom - top,
          group,
          value,
        });
      }),
    );
  }
  function drawLines(ctx, s, max, pad, w, h) {
    [
      ...(api.state.mode === "operational" ? [[s.operationalCosts, "#2671d9", []]] : []),
      [s.actualRevenue, ACTUAL, []],
      [s.expectedComplete ? s.completeExpectedRevenue : s.configuredPricingRevenue, s.expectedComplete ? "#2671d9" : "#d88416", [7, 5]],
    ].forEach(([values, color, dash], index) => {
      if (
        (api.state.mode === "operational" && index === 1 && !api.state.showActual) ||
        (api.state.mode === "operational" && index === 2 && !api.state.showExpected) ||
        (api.state.mode === "cashflow" && index === 0 && !api.state.showActual) ||
        (api.state.mode === "cashflow" && index === 1 && !api.state.showExpected)
      )
        return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash(dash);
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = xFor(i, pad, w, values.length),
          y = yFor(v, max, pad, h);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      values.forEach((v, i) => {
        const x = xFor(i, pad, w, values.length),
          y = yFor(v, max, pad, h);
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        hitTargets.push({
          type: index === 0 && api.state.mode === "operational" ? "cost-revenue" : index === (api.state.mode === "operational" ? 1 : 0) ? "actual-revenue" : "expected-revenue",
          monthIndex: i,
          x,
          y,
          radius: 9,
          value: v,
        });
      });
    });
  }
  function drawLabels(ctx, s, max, pad, w, h, mw) {
    if (!$("showValueLabels").checked) return;
    s.months.forEach((m, i) => {
      const x = xFor(i, pad, w, s.months.length);
      ctx.fillStyle = "#68758a";
      ctx.font = "11px system-ui";
      ctx.fillText(
        m.toLocaleDateString("en-TT", { month: "short" }),
        x - 15,
        pad.t + h + 22,
      );
      const cost = api.state.mode === "cashflow" ? s.paymentCashOutflows[i] : s.operationalCosts[i];
      ctx.fillStyle = "#46546a";
      ctx.fillText(compact(cost), x - 24, yFor(cost, max, pad, h) - 6);
      if (api.state.showActual)
        label(
          ctx,
          compact(s.actualRevenue[i]),
          x,
          yFor(s.actualRevenue[i], max, pad, h) - 12,
          ACTUAL,
        );
      if (api.state.showExpected)
        label(
          ctx,
          compact(s.expectedComplete ? s.completeExpectedRevenue[i] : s.configuredPricingRevenue[i]),
          x,
          yFor(s.expectedComplete ? s.completeExpectedRevenue[i] : s.configuredPricingRevenue[i], max, pad, h) + 18,
          s.expectedComplete ? EXPECTED : "#d88416",
        );
    });
  }
  function label(ctx, text, x, y, color) {
    ctx.fillStyle = color;
    ctx.font = "bold 10px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(text, x, y);
    ctx.textAlign = "start";
  }
  function updatePeriod() {
    const s = $("chartScroll"),
      monthWidth = Math.max(120, s.clientWidth / 6),
      first = Math.max(
        0,
        Math.min(
          api.state.months.length - 1,
          Math.floor(s.scrollLeft / monthWidth),
        ),
      ),
      last = Math.min(api.state.months.length - 1, first + 5);
    $("visiblePeriod").textContent =
      "Showing " +
      api.state.months[first].toLocaleDateString("en-TT", {
        month: "long",
        year: "numeric",
      }) +
      " – " +
      api.state.months[last].toLocaleDateString("en-TT", {
        month: "long",
        year: "numeric",
      });
  }
  function updateLegend(s) {
    $("legend").innerHTML =
      '<span><i class="dot" style="background:#2671d9"></i>' +
      (api.state.mode === "cashflow"
        ? "Payment Cash Outflow"
        : "Operational Cost") +
      "</span>" +
      s.groups
        .map(
          (g, i) =>
            '<span><i class="dot" style="background:' +
            COLORS[i % COLORS.length] +
            '"></i>' +
            g +
            "</span>",
        )
        .join("") +
      '<span style="color:' +
      ACTUAL +
      '"><i class="dot" style="background:' +
      ACTUAL +
      '"></i>Actual Revenue</span><span style="color:' +
      EXPECTED +
      '"><i class="dot" style="background:' +
      EXPECTED +
      '"></i>Expected Revenue' +
      (s.expectedComplete ? "" : " — Incomplete Pricing") +
      "</span>";
  }
  function handlePointer(event) {
    if (event.type === "pointerleave") {
      hideTooltip();
      return;
    }
    const rect = $("trendChart").getBoundingClientRect(),
      scale = $("trendChart").width / rect.width,
      x = (event.clientX - rect.left) * scale,
      y = (event.clientY - rect.top) * scale,
      target = hitTargets
        .slice()
        .reverse()
        .find((hit) =>
          hit.radius
            ? Math.hypot(hit.x - x, hit.y - y) <= hit.radius
            : x >= hit.x &&
              x <= hit.x + hit.width &&
              y >= hit.y &&
              y <= hit.y + hit.height,
        );
    target ? showTooltip(target, event) : hideTooltip();
  }
  function showTooltip(target, event) {
    const s = api.getSeries(),
      i = target.monthIndex,
      m = s.months[i],
      cost = s.operationalCosts[i],
      cash = s.paymentCashOutflows[i],
      actual = s.actual[i],
      expected = s.expectedComplete ? s.expected[i] : null,
      html =
        "<strong>" +
        m.toLocaleDateString("en-TT", { month: "long", year: "numeric" }) +
        "</strong><div>Operational Cost: " +
        full(cost) +
        "</div><div>Payment Cash Outflow: " +
        full(cash) +
        "</div><div>Actual Revenue: " +
        full(actual) +
        "</div><div>Expected Revenue: " +
        (expected === null ? "Incomplete pricing" : full(expected)) +
        "</div><div>Actual Operating Result: " +
        full(actual - cost) +
        "</div><div>Expected Operating Result: " +
        (expected === null ? "Incomplete pricing" : full(expected - cost)) +
        "</div>" +
        (target.type === "cost-segment"
          ? "<div><strong>" +
            target.group +
            ": " +
            full(target.value) +
            "</strong></div>"
          : "");
    const tip = $("chartTooltip");
    tip.innerHTML = html;
    tip.style.display = "block";
    const plot = $(".chart-plot"),
      pr = plot.getBoundingClientRect(),
      left = Math.min(
        Math.max(6, event.clientX - pr.left + 12, 6),
        plot.clientWidth - tip.offsetWidth - 6,
      ),
      top = Math.max(6, event.clientY - pr.top - tip.offsetHeight - 12);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hideTooltip() {
    $("chartTooltip").style.display = "none";
  }
  window.HRplusFinancialChart = {
    initialize,
    render,
    destroy: () => {
      api = null;
    },
    scrollPrevious: () => scroll(-1),
    scrollNext: () => scroll(1),
    formatCompact: compact,
  };
})();
