(function() {
    const vscode = acquireVsCodeApi();
    let cy = null;
    let graphData = null;
    let breadcrumbPath = [];

    document.addEventListener('DOMContentLoaded', () => {
        initEventListeners();
    });

    function initEventListeners() {
        document.getElementById('btn-refresh').addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh' });
        });
        document.getElementById('btn-back').addEventListener('click', () => {
            vscode.postMessage({ command: 'navigateBack' });
        });
        document.getElementById('btn-reset').addEventListener('click', () => {
            vscode.postMessage({ command: 'resetToRoot' });
        });
    }

    function applyLayout() {
        if (!cy) return;

        cy.layout({
            name: 'cose',
            padding: 20,
            animate: true,
            componentSpacing: 100,
            nodeRepulsion: 400000,
            edgeElasticity: 100,
            gravity: 80
        }).run();
    }

    function renderGraph(data) {
        graphData = data;
        breadcrumbPath = data.breadcrumb || [];
        
        updateBreadcrumb();
        updateStatus(data);

        if (!data.nodes || data.nodes.length === 0) {
            showEmptyState('当前文件未引用任何 tag');
            return;
        }

        const container = document.getElementById('graph-container');
        container.innerHTML = '';

        const elements = [
            ...data.nodes.map(n => ({
                data: {
                    id: n.id,
                    label: n.label,
                    type: n.type,
                    filePath: n.filePath,
                    line: n.line,
                    hasChildren: n.hasChildren
                },
                classes: n.type
            })),
            ...data.edges.map(e => ({
                data: {
                    id: e.id,
                    source: e.source,
                    target: e.target
                }
            }))
        ];

        cy = cytoscape({
            container: container,
            elements: elements,
            maxZoom: 1.5,
            style: [
                {
                    selector: 'node',
                    style: {
                        'background-color': '#999',
                        'label': 'data(label)',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'font-size': '11px',
                        'color': 'var(--vscode-editor-foreground)',
                        'shape': 'roundrectangle',
                        'text-wrap': 'wrap',
                        'text-max-width': '120px',
                        'width': 'label',
                        'height': 'label',
                        'padding': '10px',
                        'text-margin-y': 0
                    }
                },
                {
                    selector: 'node.center',
                    style: {
                        'background-color': '#4285F4',
                        'font-size': '12px',
                        'font-weight': 'bold',
                        'color': '#ffffff',
                        'text-max-width': '150px',
                        'padding': '15px'
                    }
                },
                {
                    selector: 'node.tag',
                    style: {
                        'background-color': (ele) => ele.data('hasChildren') ? '#FF9800' : '#34A853',
                        'border-width': 2,
                        'border-color': (ele) => ele.data('hasChildren') ? '#F57C00' : '#2E7D32',
                        'color': '#ffffff',
                        'text-max-width': '120px'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'width': 2,
                        'line-color': '#999',
                        'target-arrow-color': '#999',
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier'
                    }
                }
            ],
            layout: { name: 'cose' }
        });

        cy.on('tap', 'node', (evt) => {
            const node = evt.target;
            const type = node.data('type');
            const filePath = node.data('filePath');
            const line = node.data('line');
            const hasChildren = node.data('hasChildren');
            const id = node.data('id');
            const label = node.data('label');

            if (type === 'tag') {
                if (hasChildren) {
                    vscode.postMessage({
                        command: 'expandNode',
                        nodeId: id,
                        filePath: filePath,
                        label: label
                    });
                } else {
                    vscode.postMessage({
                        command: 'goToDefinition',
                        filePath: filePath,
                        line: line
                    });
                }
            }
        });

        applyLayout();
    }

    function updateBreadcrumb() {
        const container = document.getElementById('breadcrumb');
        if (!breadcrumbPath.length) {
            container.innerHTML = '';
            return;
        }

        const html = breadcrumbPath.map((item, index) => {
            const isLast = index === breadcrumbPath.length - 1;
            const span = `<span class="breadcrumb-item ${isLast ? 'current' : ''}" data-index="${index}">${escapeHtml(item.label)}</span>`;
            if (isLast) return span;
            return span + '<span class="breadcrumb-separator">></span>';
        }).join('');

        container.innerHTML = html;

        container.querySelectorAll('.breadcrumb-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                vscode.postMessage({
                    command: 'navigateToLevel',
                    level: index
                });
            });
        });

        document.getElementById('btn-back').disabled = breadcrumbPath.length <= 1;
    }

    function updateStatus(data) {
        const status = document.getElementById('status');
        const levelText = data.level === 0 ? '文件层' : `第 ${data.level} 层`;
        const countText = data.nodes ? `共 ${data.nodes.length - 1} 个引用` : '';
        status.textContent = `${levelText} ${countText}`;
    }

    function showEmptyState(message) {
        const container = document.getElementById('graph-container');
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📊</div>
                <div>${escapeHtml(message)}</div>
            </div>
        `;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.command) {
            case 'updateGraph':
                renderGraph(message.data);
                break;
            case 'showError':
                showEmptyState(message.error);
                break;
        }
    });
})();
