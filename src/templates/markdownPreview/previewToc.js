/**
 * Markdown 预览页目录（TOC）
 * 依赖页面已有 #previewToc 等 DOM；由 preview.js 注入 vscode（勿二次 acquireVsCodeApi）。
 * 渲染后调用 rebuild() 根据预览区标题重建目录。
 */
(function(global) {
    let vscode = null;
    let previewArea = null;
    let previewToc = null;
    let previewTocList = null;
    let previewTocHeader = null;
    let previewTocClose = null;
    let previewTocMinimize = null;
    let previewTocFab = null;
    let showTocToggle = null;

    let showToc = true;
    let tocMinimized = true;
    /** @type {{ heading: Element, row: HTMLElement, button: HTMLButtonElement, twistie: HTMLButtonElement|null, level: number, collapsed: boolean, hasChildren: boolean }[]} */
    let tocEntries = [];
    let tocScrollRaf = 0;
    let tocDrag = null;
    let tocPosition = null;
    /** 点击目录跳转期间锁定高亮，避免平滑滚动途中闪烁切换 */
    let tocHighlightLocked = false;
    let tocUnlockTimer = null;
    /** 当前高亮目录项索引；仅在正文滚动导致索引变化时才滚动目录列表 */
    let lastActiveTocIndex = -1;
    let initialized = false;

    /** 将 TOC 显隐、最小化、拖拽位置写入 webview state（跨消息刷新仍保留） */
    function persistTocState() {
        if (!vscode || typeof vscode.getState !== 'function' || typeof vscode.setState !== 'function') {
            return;
        }
        const prev = vscode.getState() || {};
        const next = Object.assign({}, prev, {
            showToc: showToc,
            tocMinimized: tocMinimized
        });
        if (tocPosition && typeof tocPosition.left === 'number' && typeof tocPosition.top === 'number') {
            next.tocLeft = tocPosition.left;
            next.tocTop = tocPosition.top;
        }
        vscode.setState(next);
    }

    /** 最小化时隐藏面板、显示 FAB；展开时反之 */
    function applyTocMinimizedUi() {
        if (!previewToc) {
            return;
        }
        if (tocMinimized) {
            previewToc.classList.add('is-minimized');
            if (previewTocFab) {
                previewTocFab.removeAttribute('hidden');
            }
        } else {
            previewToc.classList.remove('is-minimized');
            if (previewTocFab) {
                previewTocFab.setAttribute('hidden', '');
            }
        }
    }

    /** 拖拽时把面板限制在视口内，避免拖出屏幕 */
    function clampTocPosition(left, top) {
        if (!previewToc) {
            return { left: left, top: top };
        }
        const width = previewToc.offsetWidth || 240;
        const height = previewToc.offsetHeight || 120;
        const maxLeft = Math.max(8, window.innerWidth - width - 8);
        const maxTop = Math.max(8, window.innerHeight - Math.min(height, window.innerHeight - 16) - 8);
        return {
            left: Math.min(Math.max(8, left), maxLeft),
            top: Math.min(Math.max(8, top), maxTop)
        };
    }

    /** 应用拖拽坐标；最小化或无坐标时清掉内联定位，交回 CSS 默认布局 */
    function applyTocPosition() {
        if (!previewToc) {
            return;
        }
        if (tocMinimized) {
            previewToc.style.left = '';
            previewToc.style.top = '';
            previewToc.style.right = '';
            previewToc.style.bottom = '';
            return;
        }
        if (!tocPosition) {
            previewToc.style.left = '';
            previewToc.style.top = '';
            previewToc.style.right = '';
            previewToc.style.bottom = '';
            return;
        }
        const pos = clampTocPosition(tocPosition.left, tocPosition.top);
        tocPosition = pos;
        previewToc.style.left = pos.left + 'px';
        previewToc.style.top = pos.top + 'px';
        previewToc.style.right = 'auto';
        previewToc.style.bottom = 'auto';
    }

    function closeTocPanel() {
        showToc = false;
        applyTocVisibility();
        persistTocState();
    }

    function applyTocVisibility() {
        if (!previewToc || !showTocToggle) {
            return;
        }
        showTocToggle.checked = showToc;
        if (showToc) {
            previewToc.removeAttribute('hidden');
            applyTocMinimizedUi();
            applyTocPosition();
            if (!tocMinimized) {
                updateActiveTocFromScroll();
            }
        } else {
            previewToc.setAttribute('hidden', '');
        }
    }

    /** 从 webview state 恢复 TOC；无状态时默认显示且最小化 */
    function restoreTocState() {
        const state = vscode && typeof vscode.getState === 'function' ? vscode.getState() : null;
        if (state && typeof state.showToc === 'boolean') {
            showToc = state.showToc;
        } else {
            showToc = true;
        }
        if (state && typeof state.tocMinimized === 'boolean') {
            tocMinimized = state.tocMinimized;
        } else {
            tocMinimized = true;
        }
        if (state && typeof state.tocLeft === 'number' && typeof state.tocTop === 'number') {
            tocPosition = { left: state.tocLeft, top: state.tocTop };
        }
        applyTocVisibility();
    }

    function getHeadingLabel(headingEl) {
        const text = (headingEl.textContent || '').replace(/\s+/g, ' ').trim();
        return text || '（空标题）';
    }

    /** 下一项标题层级更深则视为有子节点（可折叠） */
    function tocEntryHasChildren(index) {
        if (index + 1 >= tocEntries.length) {
            return false;
        }
        return tocEntries[index + 1].level > tocEntries[index].level;
    }

    /** 任一祖先 collapsed 则本项不可见 */
    function isTocEntryVisible(index) {
        let level = tocEntries[index].level;
        for (let j = index - 1; j >= 0; j--) {
            if (tocEntries[j].level < level) {
                if (tocEntries[j].collapsed) {
                    return false;
                }
                level = tocEntries[j].level;
            }
        }
        return true;
    }

    function syncTwistie(entry) {
        if (!entry.twistie) {
            return;
        }
        entry.twistie.textContent = entry.collapsed ? '▶' : '▼';
        entry.twistie.setAttribute('aria-label', entry.collapsed ? '展开' : '折叠');
        entry.twistie.title = entry.collapsed ? '展开' : '折叠';
    }

    function applyTocCollapseVisibility() {
        for (let i = 0; i < tocEntries.length; i++) {
            const entry = tocEntries[i];
            if (isTocEntryVisible(i)) {
                entry.row.removeAttribute('hidden');
            } else {
                entry.row.setAttribute('hidden', '');
            }
        }
    }

    /** 高亮或跳转到折叠子树内标题时，自动展开其祖先 */
    function expandTocAncestors(index) {
        let level = tocEntries[index].level;
        let changed = false;
        for (let j = index - 1; j >= 0; j--) {
            if (tocEntries[j].level < level) {
                if (tocEntries[j].collapsed) {
                    tocEntries[j].collapsed = false;
                    syncTwistie(tocEntries[j]);
                    changed = true;
                }
                level = tocEntries[j].level;
            }
        }
        if (changed) {
            applyTocCollapseVisibility();
        }
    }

    function clearTocUnlockTimer() {
        if (tocUnlockTimer) {
            clearTimeout(tocUnlockTimer);
            tocUnlockTimer = null;
        }
    }

    function unlockTocHighlight() {
        tocHighlightLocked = false;
        clearTocUnlockTimer();
    }

    /** 点击跳转时锁定当前高亮；滚动停稳或超时后解锁，恢复跟滚高亮 */
    function lockTocHighlightForNavigation() {
        tocHighlightLocked = true;
        clearTocUnlockTimer();
        tocUnlockTimer = setTimeout(unlockTocHighlight, 450);
    }

    /** 仅调整目录列表 scrollTop，避免 scrollIntoView 带动正文滚动 */
    function scrollTocRowIntoListView(row) {
        if (!previewTocList || !row || !previewToc || previewToc.hasAttribute('hidden') || tocMinimized) {
            return;
        }
        const listRect = previewTocList.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        if (rowRect.top < listRect.top) {
            previewTocList.scrollTop += rowRect.top - listRect.top;
        } else if (rowRect.bottom > listRect.bottom) {
            previewTocList.scrollTop += rowRect.bottom - listRect.bottom;
        }
    }

    /**
     * @param {HTMLButtonElement} activeButton
     * @param {{ ensureVisible?: boolean }} [options]
     * ensureVisible: 仅正文滚动导致章节变化时为 true，用户手动滚目录时不强制对齐
     */
    function setActiveTocButton(activeButton, options) {
        const ensureVisible = !!(options && options.ensureVisible);
        let activeIndex = -1;
        for (let i = 0; i < tocEntries.length; i++) {
            const entry = tocEntries[i];
            if (entry.button === activeButton) {
                entry.button.classList.add('is-active');
                activeIndex = i;
            } else {
                entry.button.classList.remove('is-active');
            }
        }
        if (activeIndex >= 0) {
            const indexChanged = activeIndex !== lastActiveTocIndex;
            expandTocAncestors(activeIndex);
            if (ensureVisible && indexChanged) {
                scrollTocRowIntoListView(tocEntries[activeIndex].row);
            }
            lastActiveTocIndex = activeIndex;
        }
    }

    /** 视口顶部附近最后一个已越过的标题视为当前章节 */
    function updateActiveTocFromScroll() {
        if (!tocEntries.length || tocHighlightLocked) {
            return;
        }

        const markerY = 96;
        let activeIndex = 0;
        for (let i = 0; i < tocEntries.length; i++) {
            const top = tocEntries[i].heading.getBoundingClientRect().top;
            if (top <= markerY) {
                activeIndex = i;
            } else {
                break;
            }
        }
        setActiveTocButton(tocEntries[activeIndex].button, { ensureVisible: true });
    }

    /** 忽略目录面板自身滚动，避免跟滚高亮把用户的目录滚动拽回去 */
    function isTocScrollEvent(e) {
        return !!(previewToc && e && e.target && previewToc.contains(e.target));
    }

    /** 正文滚动时 rAF 合并更新当前章节高亮；目录自身滚动忽略 */
    function scheduleActiveTocUpdate(e) {
        if (isTocScrollEvent(e)) {
            return;
        }
        if (!showToc || !tocEntries.length || tocDrag) {
            return;
        }
        if (tocHighlightLocked) {
            clearTocUnlockTimer();
            tocUnlockTimer = setTimeout(unlockTocHighlight, 180);
            return;
        }
        if (tocScrollRaf) {
            return;
        }
        tocScrollRaf = window.requestAnimationFrame(function() {
            tocScrollRaf = 0;
            updateActiveTocFromScroll();
        });
    }

    /** 根据预览区 h1–h6 重建目录树（含 twistie 折叠） */
    function rebuild() {
        if (!previewTocList || !previewArea) {
            return;
        }

        unlockTocHighlight();
        lastActiveTocIndex = -1;
        previewTocList.innerHTML = '';
        tocEntries = [];

        const headings = previewArea.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (headings.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'preview-toc-empty';
            empty.textContent = '暂无标题';
            previewTocList.appendChild(empty);
            return;
        }

        headings.forEach(function(headingEl) {
            const level = parseInt(headingEl.tagName.charAt(1), 10);
            const row = document.createElement('div');
            row.className = 'preview-toc-row';
            row.setAttribute('data-level', String(level));

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'preview-toc-item';
            btn.textContent = getHeadingLabel(headingEl);
            btn.title = btn.textContent;
            btn.addEventListener('click', function() {
                lockTocHighlightForNavigation();
                setActiveTocButton(btn);
                headingEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });

            const entry = {
                heading: headingEl,
                row: row,
                button: btn,
                twistie: null,
                level: level,
                collapsed: false,
                hasChildren: false
            };
            tocEntries.push(entry);
            previewTocList.appendChild(row);
        });

        for (let i = 0; i < tocEntries.length; i++) {
            const entry = tocEntries[i];
            entry.hasChildren = tocEntryHasChildren(i);
            if (entry.hasChildren) {
                const twistie = document.createElement('button');
                twistie.type = 'button';
                twistie.className = 'preview-toc-twistie';
                entry.twistie = twistie;
                syncTwistie(entry);
                twistie.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    entry.collapsed = !entry.collapsed;
                    syncTwistie(entry);
                    applyTocCollapseVisibility();
                });
                entry.row.appendChild(twistie);
            } else {
                const spacer = document.createElement('span');
                spacer.className = 'preview-toc-twistie-spacer';
                entry.row.appendChild(spacer);
            }
            entry.row.appendChild(entry.button);
        }

        applyTocCollapseVisibility();
        updateActiveTocFromScroll();
    }

    /** 拖拽目录标题栏移动面板；关闭/最小化按钮不触发拖拽 */
    function initTocDrag() {
        if (!previewToc || !previewTocHeader) {
            return;
        }

        function isTocChromeButton(target) {
            return !!(target && target.closest && (
                target.closest('#previewTocClose') ||
                target.closest('#previewTocMinimize')
            ));
        }

        previewTocHeader.addEventListener('mousedown', function(e) {
            if (e.button !== 0 || tocMinimized) {
                return;
            }
            if (isTocChromeButton(e.target)) {
                return;
            }
            e.preventDefault();
            const rect = previewToc.getBoundingClientRect();
            tocDrag = {
                offsetX: e.clientX - rect.left,
                offsetY: e.clientY - rect.top
            };
            previewToc.classList.add('dragging');
        });

        window.addEventListener('mousemove', function(e) {
            if (!tocDrag || !previewToc || tocMinimized) {
                return;
            }
            const next = clampTocPosition(e.clientX - tocDrag.offsetX, e.clientY - tocDrag.offsetY);
            tocPosition = next;
            previewToc.style.left = next.left + 'px';
            previewToc.style.top = next.top + 'px';
            previewToc.style.right = 'auto';
            previewToc.style.bottom = 'auto';
        });

        window.addEventListener('mouseup', function() {
            if (!tocDrag) {
                return;
            }
            tocDrag = null;
            if (previewToc) {
                previewToc.classList.remove('dragging');
            }
            persistTocState();
        });
    }

    /** 绑定 TOC 显隐/最小化/FAB、滚动跟高亮与窗口 resize */
    function bindControls() {
        restoreTocState();
        initTocDrag();
        window.addEventListener('scroll', scheduleActiveTocUpdate, { passive: true });
        document.addEventListener('scroll', scheduleActiveTocUpdate, { passive: true, capture: true });
        if (previewArea) {
            previewArea.addEventListener('scroll', scheduleActiveTocUpdate, { passive: true });
        }
        if (previewTocClose) {
            previewTocClose.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                closeTocPanel();
            });
        }
        if (previewTocMinimize) {
            previewTocMinimize.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                tocMinimized = true;
                applyTocMinimizedUi();
                applyTocPosition();
                persistTocState();
            });
        }
        if (previewTocFab) {
            previewTocFab.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (!tocMinimized) {
                    return;
                }
                tocMinimized = false;
                applyTocMinimizedUi();
                applyTocPosition();
                updateActiveTocFromScroll();
                persistTocState();
            });
        }
        window.addEventListener('resize', function() {
            if (showToc) {
                applyTocPosition();
            }
        });
        if (!showTocToggle) {
            return;
        }
        showTocToggle.addEventListener('change', function() {
            showToc = !!showTocToggle.checked;
            applyTocVisibility();
            persistTocState();
        });
    }

    /**
     * @param {{ previewArea?: HTMLElement, vscode?: { getState: Function, setState: Function } }} options
     */
    function init(options) {
        if (initialized) {
            return;
        }
        const opts = options || {};
        previewArea = opts.previewArea || document.getElementById('previewArea');
        vscode = opts.vscode || null;

        previewToc = document.getElementById('previewToc');
        if (!previewToc) {
            return;
        }

        previewTocList = document.getElementById('previewTocList');
        previewTocHeader = document.getElementById('previewTocHeader');
        previewTocClose = document.getElementById('previewTocClose');
        previewTocMinimize = document.getElementById('previewTocMinimize');
        previewTocFab = document.getElementById('previewTocFab');
        showTocToggle = document.getElementById('showTocToggle');

        bindControls();
        initialized = true;
    }

    global.PreviewToc = {
        init: init,
        rebuild: rebuild
    };
})(typeof window !== 'undefined' ? window : this);
