const vscode = acquireVsCodeApi();

const CMD = {
    GET_COMMENT_ROWS: 'getCommentRows',
    COMMENT_ROWS_RESULT: 'commentRowsResult',
    OPEN_COMMENT_ROW: 'openCommentRow',
    DELETE_COMMENT_ROWS: 'deleteCommentRows',
    MOVE_COMMENT_ROWS: 'moveCommentRows',
    EDIT_COMMENT_ROW: 'editCommentRow',
    PREVIEW_COMMENT_ROW: 'previewCommentRow',
    EXPORT_COMMENT_ROWS: 'exportCommentRows',
    APPLY_COMMENT_GROUP_FROM_PANEL: 'applyCommentGroupFromPanel',
};

const groupLabelEl = document.getElementById('group-label');
const previewBannerEl = document.getElementById('preview-banner');
const btnApplyGroupEl = document.getElementById('btn-apply-group');
const searchInputEl = document.getElementById('search-input');
const filterKindEl = document.getElementById('filter-kind');
const sortKeyEl = document.getElementById('sort-key');
const sortDirEl = document.getElementById('sort-dir');
const selectAllEl = document.getElementById('select-all');
const btnBatchDeleteEl = document.getElementById('btn-batch-delete');
const btnBatchMoveEl = document.getElementById('btn-batch-move');
const btnBatchExportEl = document.getElementById('btn-batch-export');
const tableContainerEl = document.getElementById('table-container');
const commentTableEl = document.getElementById('comment-table');
const commentTbodyEl = document.getElementById('comment-tbody');
const emptyStateEl = document.getElementById('empty-state');

let allRows = [];
let isActiveGroup = true;
let filterDebounceTimer = null;
const selectedIds = new Set();

function formatGroupName(fileName) {
    if (!fileName) {
        return '—';
    }
    return fileName.replace(/\.json$/i, '');
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getFilterParams() {
    return {
        query: searchInputEl.value.trim(),
        commentKind: filterKindEl.value,
        sortKey: sortKeyEl.value,
        sortDir: sortDirEl.value,
    };
}

function requestCommentRows() {
    vscode.postMessage({
        command: CMD.GET_COMMENT_ROWS,
        ...getFilterParams(),
    });
}

function formatCommentDate(isoString) {
    if (!isoString) {
        return '—';
    }
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function renderTagDeclarations(declarations) {
    if (!declarations || declarations.length === 0) {
        return '<span class="tag-empty">—</span>';
    }
    return declarations
        .map((tag) => `<span class="tag">${escapeHtml('${' + tag + '}')}</span>`)
        .join('');
}

function openCommentRow(filePath, line, id) {
    vscode.postMessage({
        command: CMD.OPEN_COMMENT_ROW,
        filePath,
        line,
        id,
    });
}

function deleteCommentRows(ids) {
    vscode.postMessage({
        command: CMD.DELETE_COMMENT_ROWS,
        ids,
    });
}

function moveCommentRows(ids) {
    vscode.postMessage({
        command: CMD.MOVE_COMMENT_ROWS,
        ids,
    });
}

function editCommentRow(id) {
    vscode.postMessage({
        command: CMD.EDIT_COMMENT_ROW,
        id,
    });
}

function previewCommentRow(id) {
    vscode.postMessage({
        command: CMD.PREVIEW_COMMENT_ROW,
        id,
    });
}

function exportCommentRows(ids) {
    vscode.postMessage({
        command: CMD.EXPORT_COMMENT_ROWS,
        ids,
    });
}

function getSelectedIds() {
    return [...selectedIds];
}

function updateBatchButtons() {
    const count = selectedIds.size;
    btnBatchDeleteEl.disabled = count === 0;
    btnBatchMoveEl.disabled = count === 0;
    btnBatchExportEl.disabled = count === 0;
    btnBatchDeleteEl.textContent = count > 0 ? `批量删除 (${count})` : '批量删除';
    btnBatchMoveEl.textContent = count > 0 ? `移动分组 (${count})` : '移动分组';
    btnBatchExportEl.textContent = count > 0 ? `批量导出 (${count})` : '批量导出';
}

function syncSelectAllState(visibleRows) {
    if (!visibleRows.length) {
        selectAllEl.checked = false;
        selectAllEl.indeterminate = false;
        return;
    }
    const selectedVisible = visibleRows.filter((row) => selectedIds.has(row.id)).length;
    selectAllEl.checked = selectedVisible === visibleRows.length;
    selectAllEl.indeterminate = selectedVisible > 0 && selectedVisible < visibleRows.length;
}

function createActionButton(label, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `action-btn ${className}`;
    btn.textContent = label;
    btn.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
    });
    return btn;
}

function updatePreviewMode(active) {
    isActiveGroup = active;
    previewBannerEl.style.display = active ? 'none' : 'flex';
}

function renderRows(data) {
    const rows = data.rows || [];
    const groupFileName = data.groupFileName || '';
    const activeGroupFileName = data.activeGroupFileName || groupFileName;
    const active = data.isActiveGroup !== false;
    updatePreviewMode(active);

    if (Array.isArray(data.allRows)) {
        allRows = data.allRows;
    }

    const validIds = new Set(allRows.map((row) => row.id));
    for (const id of selectedIds) {
        if (!validIds.has(id)) {
            selectedIds.delete(id);
        }
    }

    if (active) {
        groupLabelEl.textContent = `当前分组：${formatGroupName(groupFileName)}`;
    } else {
        groupLabelEl.textContent = `预览分组：${formatGroupName(groupFileName)}（当前使用：${formatGroupName(activeGroupFileName)}）`;
    }

    if (rows.length === 0) {
        tableContainerEl.style.display = 'none';
        commentTableEl.style.display = 'none';
        emptyStateEl.style.display = 'block';
        commentTbodyEl.innerHTML = '';
        syncSelectAllState([]);
        updateBatchButtons();
        return;
    }

    tableContainerEl.style.display = 'block';
    commentTableEl.style.display = 'table';
    emptyStateEl.style.display = 'none';
    commentTbodyEl.innerHTML = '';

    rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.dataset.id = row.id;

        const checkTd = document.createElement('td');
        checkTd.className = 'col-check';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'row-check';
        checkbox.dataset.id = row.id;
        checkbox.checked = selectedIds.has(row.id);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                selectedIds.add(row.id);
            } else {
                selectedIds.delete(row.id);
            }
            syncSelectAllState(rows);
            updateBatchButtons();
        });
        checkTd.appendChild(checkbox);

        const fileTd = document.createElement('td');
        fileTd.className = 'col-file';
        const fileLink = document.createElement('span');
        fileLink.className = 'cell-link';
        fileLink.textContent = row.filePath;
        fileLink.title = row.filePath;
        fileLink.addEventListener('click', () => openCommentRow(row.filePath, row.line, row.id));
        fileTd.appendChild(fileLink);

        const lineTd = document.createElement('td');
        lineTd.className = 'col-line';
        const lineSpan = document.createElement('span');
        lineSpan.className = 'cell-line';
        lineSpan.textContent = String(row.line + 1);
        lineSpan.title = `跳转到第 ${row.line + 1} 行`;
        lineSpan.addEventListener('click', () => openCommentRow(row.filePath, row.line, row.id));
        lineTd.appendChild(lineSpan);

        const summaryTd = document.createElement('td');
        summaryTd.className = 'col-summary';
        summaryTd.textContent = row.summary || '—';
        summaryTd.title = row.content || row.summary || '';

        const tagsTd = document.createElement('td');
        tagsTd.className = 'col-tags';
        tagsTd.innerHTML = `<span class="tag-list">${renderTagDeclarations(row.tagDeclarations)}</span>`;

        const dateTd = document.createElement('td');
        dateTd.className = 'col-date';
        dateTd.textContent = formatCommentDate(row.updatedAt);
        if (row.updatedAt) {
            dateTd.title = new Date(row.updatedAt).toLocaleString('zh-CN');
        }

        const actionsTd = document.createElement('td');
        actionsTd.className = 'col-actions';
        const actionsWrap = document.createElement('span');
        actionsWrap.className = 'action-list';
        if (isActiveGroup) {
            actionsWrap.appendChild(createActionButton('编辑', 'action-edit', () => editCommentRow(row.id)));
            actionsWrap.appendChild(createActionButton('删除', 'action-delete', () => deleteCommentRows([row.id])));
        }
        actionsWrap.appendChild(createActionButton('预览', 'action-preview', () => previewCommentRow(row.id)));
        actionsTd.appendChild(actionsWrap);

        tr.appendChild(checkTd);
        tr.appendChild(fileTd);
        tr.appendChild(lineTd);
        tr.appendChild(summaryTd);
        tr.appendChild(tagsTd);
        tr.appendChild(dateTd);
        tr.appendChild(actionsTd);
        commentTbodyEl.appendChild(tr);
    });

    syncSelectAllState(rows);
    updateBatchButtons();
}

function onFilterChange() {
    requestCommentRows();
}

function onSearchInput() {
    if (filterDebounceTimer) {
        clearTimeout(filterDebounceTimer);
    }
    filterDebounceTimer = setTimeout(onFilterChange, 200);
}

selectAllEl.addEventListener('change', () => {
    const checkboxes = commentTbodyEl.querySelectorAll('.row-check');
    checkboxes.forEach((checkbox) => {
        const id = checkbox.dataset.id;
        checkbox.checked = selectAllEl.checked;
        if (selectAllEl.checked) {
            selectedIds.add(id);
        } else {
            selectedIds.delete(id);
        }
    });
    selectAllEl.indeterminate = false;
    updateBatchButtons();
});

btnBatchDeleteEl.addEventListener('click', () => {
    const ids = getSelectedIds();
    if (ids.length === 0) {
        return;
    }
    deleteCommentRows(ids);
});

btnBatchMoveEl.addEventListener('click', () => {
    const ids = getSelectedIds();
    if (ids.length === 0) {
        return;
    }
    moveCommentRows(ids);
});

btnBatchExportEl.addEventListener('click', () => {
    const ids = getSelectedIds();
    if (ids.length === 0) {
        return;
    }
    exportCommentRows(ids);
});

searchInputEl.addEventListener('input', onSearchInput);
filterKindEl.addEventListener('change', onFilterChange);
sortKeyEl.addEventListener('change', onFilterChange);
sortDirEl.addEventListener('change', onFilterChange);

btnApplyGroupEl.addEventListener('click', () => {
    vscode.postMessage({ command: CMD.APPLY_COMMENT_GROUP_FROM_PANEL });
});

window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.command === CMD.COMMENT_ROWS_RESULT) {
        renderRows(message);
    }
});

requestCommentRows();