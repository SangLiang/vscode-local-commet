/**
 * Mermaid 图表交互（缩放按钮、Ctrl+滚轮、拖拽平移）
 * 依赖同页先加载的 public.js（window.fitMermaidChart）
 * 供预览页与导出 HTML 共用；控件 onclick 依赖 window.zoomChart / resetChart。
 */
(function(global) {
    function getChart(chartId) {
        return document.querySelector('[data-chart-id="' + chartId + '"]');
    }

    function initChartState(chart) {
        chart.dataset.scale = '1';
        chart.dataset.translateX = '0';
        chart.dataset.translateY = '0';
    }

    function updateChartTransform(chart) {
        const scale = parseFloat(chart.dataset.scale) || 1;
        const translateX = parseFloat(chart.dataset.translateX) || 0;
        const translateY = parseFloat(chart.dataset.translateY) || 0;
        const svg = chart.querySelector('svg');
        if (svg) {
            svg.style.transformOrigin = '0 0';
            svg.style.transform = 'translate(' + translateX + 'px, ' + translateY + 'px) scale(' + scale + ')';
        }
        if (scale > 1 || translateX !== 0 || translateY !== 0) {
            chart.classList.add('zoomed');
        } else {
            chart.classList.remove('zoomed');
        }
    }

    function updateZoomInfo(chart) {
        const zoomInfo = chart.querySelector('.mermaid-zoom-info');
        if (zoomInfo) {
            const scale = parseFloat(chart.dataset.scale) || 1;
            zoomInfo.textContent = Math.round(scale * 100) + '%';
        }
    }

    function setupChartWheelZoom(chart) {
        chart.addEventListener('wheel', function(e) {
            if (!e.ctrlKey) return;

            const currentScale = parseFloat(chart.dataset.scale) || 1;
            const svg = chart.querySelector('svg');
            if (!svg) return;

            e.preventDefault();

            const rect = svg.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const zoomIntensity = 0.0005;
            const factor = Math.exp(-e.deltaY * zoomIntensity);
            const newScale = Math.max(0.1, Math.min(5, currentScale * factor));
            const ratio = newScale / currentScale;
            const currentTranslateX = parseFloat(chart.dataset.translateX) || 0;
            const currentTranslateY = parseFloat(chart.dataset.translateY) || 0;

            chart.dataset.scale = String(newScale);
            chart.dataset.translateX = String(mouseX * (1 - ratio) + currentTranslateX * ratio);
            chart.dataset.translateY = String(mouseY * (1 - ratio) + currentTranslateY * ratio);
            updateChartTransform(chart);
            updateZoomInfo(chart);
        });
    }

    function setupChartDrag(chart) {
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let startTranslateX = 0;
        let startTranslateY = 0;

        chart.addEventListener('mousedown', function(e) {
            if (e.target.closest('.mermaid-controls')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startTranslateX = parseFloat(chart.dataset.translateX) || 0;
            startTranslateY = parseFloat(chart.dataset.translateY) || 0;
            chart.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            chart.dataset.translateX = String(startTranslateX + e.clientX - startX);
            chart.dataset.translateY = String(startTranslateY + e.clientY - startY);
            updateChartTransform(chart);
        });

        function endDrag() {
            if (!isDragging) return;
            isDragging = false;
            chart.style.cursor = 'grab';
        }

        document.addEventListener('mouseup', endDrag);
        document.addEventListener('mouseleave', endDrag);
    }

    /**
     * @param {Element} chart
     * @param {{ ensureId?: boolean, fit?: boolean }} [options]
     */
    function initChart(chart, options) {
        const opts = options || {};
        if (!chart.dataset.chartId) {
            if (opts.ensureId === false) {
                return;
            }
            chart.dataset.chartId = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        }

        chart.style.cursor = 'grab';

        if (opts.fit !== false && typeof global.fitMermaidChart === 'function') {
            global.fitMermaidChart(chart);
        }

        initChartState(chart);
        updateChartTransform(chart);
        updateZoomInfo(chart);
        setupChartWheelZoom(chart);
        setupChartDrag(chart);
    }

    /**
     * @param {ParentNode} [root]
     * @param {{ ensureId?: boolean, fit?: boolean }} [options]
     */
    function initAll(root, options) {
        const scope = root || document;
        scope.querySelectorAll('.mermaid-chart').forEach(function(chart) {
            initChart(chart, options);
        });
    }

    global.zoomChart = function(chartId, factor) {
        const chart = getChart(chartId);
        if (!chart) return;
        const currentScale = parseFloat(chart.dataset.scale) || 1;
        const newScale = Math.max(0.1, Math.min(5, currentScale * factor));
        chart.dataset.scale = String(newScale);
        updateChartTransform(chart);
        updateZoomInfo(chart);
    };

    global.resetChart = function(chartId) {
        const chart = getChart(chartId);
        if (!chart) return;
        initChartState(chart);
        updateChartTransform(chart);
        updateZoomInfo(chart);
    };

    global.MermaidChartInteract = {
        initChart: initChart,
        initAll: initAll
    };
})(typeof window !== 'undefined' ? window : this);
