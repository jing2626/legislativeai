// progress_script.js - 進度頁面專用JavaScript

// --- 新增：將自訂格式文字轉換為 HTML 的函式 ---
function convertCustomMarkdownToHTML(text) {
    if (!text) return '';
    let html = text;
    
    // 1. 處理 **粗體文字** -> <strong>粗體文字</strong>
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // 2. 處理 &&標題&& -> <h3>標題</h3>
    html = html.replace(/&&([^&\n]+)&&/g, '<h3>$1</h3>');

    // 3. 處理換行符號 -> <br>
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

document.addEventListener('DOMContentLoaded', () => {
    // --- 全域變數 ---
    let categoryDefinitions = {};
    let allBillsData = []; // 儲存所有法案資料
    let filteredBillsData = []; // 當前篩選後的法案資料
    let currentProgressFilter = ''; // 當前選擇的進度
    let currentCategoryFilter = ''; // 當前選擇的種類
    let legislatorPartyMap = new Map();
    let availableMonths = []; // 儲存可用的月份列表
    let currentTimeRange = null; // 目前選擇的時間範圍

    // DOM 元素
    const billContainer = document.getElementById('bill-container');
    const billListTitle = document.getElementById('bill-list-title');
    const billCountInfo = document.getElementById('bill-count-info');
    const paginationContainer = document.getElementById('pagination-container');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalBody = document.getElementById('modal-body');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    
    // 時間範圍相關元素
    const startMonthSelect = document.getElementById('start-month');
    const endMonthSelect = document.getElementById('end-month');
    const applyTimeRangeBtn = document.getElementById('apply-time-range');
    const resetToLatestBtn = document.getElementById('reset-to-latest');
    const currentTimeRangeDisplay = document.getElementById('current-time-range');
    
    // 篩選相關元素
    const categoryFilterSelect = document.getElementById('category-filter');
    const clearFiltersBtn = document.getElementById('clear-filters-btn');

    // 進度統計卡片
    const progressStatCards = document.querySelectorAll('.progress-stat-card');

    // --- 進度分類函式 ---
    function classifyProgress(progressText) {
        if (!progressText) return '其他';
        
        const text = progressText.toLowerCase();
        
        if (text.includes('一讀')) {
            return '一讀';
        } else if (text.includes('委員會審議')) {
            return '委員會審議';
        } else if (text.includes('二讀')) {
            return '二讀';
        } else if (text.includes('三讀')) {
            return '三讀';
        } else {
            return '其他';
        }
    }

    // --- 初始化函式 ---
    async function initializePage() {
        try {
            // 載入分類定義
            const categoriesResponse = await fetch('/api/categories');
            if (categoriesResponse.ok) {
                categoryDefinitions = await categoriesResponse.json();
                populateCategoryFilter();
            }

            // 載入立委資料
            const legResponse = await fetch('/api/legislators.json');
            if (legResponse.ok) {
                const legislatorData = await legResponse.json();
                legislatorData.jsonList.forEach(leg => {
                    legislatorPartyMap.set(normalizeName(leg.name), leg.party);
                });
            }

            // 載入可用月份
            await loadAvailableMonths();

            // 預設載入最新3個月的資料
            await loadLatestThreeMonths();

        } catch (error) {
            console.error('初始化頁面時發生錯誤:', error);
            billContainer.innerHTML = '<p class="error-text">載入頁面時發生錯誤</p>';
        }
    }

    // --- 時間範圍相關函式 ---
    async function loadAvailableMonths() {
        try {
            const response = await fetch('/api/available-months');
            if (!response.ok) throw new Error('無法載入可用月份');
            
            availableMonths = await response.json();
            populateMonthSelects();
        } catch (error) {
            console.error('載入可用月份時發生錯誤:', error);
            startMonthSelect.innerHTML = '<option value="">載入失敗</option>';
            endMonthSelect.innerHTML = '<option value="">載入失敗</option>';
        }
    }

    function populateMonthSelects() {
        if (availableMonths.length === 0) {
            startMonthSelect.innerHTML = '<option value="">無可用資料</option>';
            endMonthSelect.innerHTML = '<option value="">無可用資料</option>';
            return;
        }

        const options = availableMonths.map(month => 
            `<option value="${month.year}-${month.month.toString().padStart(2, '0')}">${month.label}</option>`
        ).join('');

        startMonthSelect.innerHTML = options;
        endMonthSelect.innerHTML = options;

        // 預設選擇最新的月份作為結束月份，最新的第3個月作為開始月份
        if (availableMonths.length >= 3) {
            const latestMonth = availableMonths[0];
            const thirdLatestMonth = availableMonths[2];
            startMonthSelect.value = `${thirdLatestMonth.year}-${thirdLatestMonth.month.toString().padStart(2, '0')}`;
            endMonthSelect.value = `${latestMonth.year}-${latestMonth.month.toString().padStart(2, '0')}`;
        } else if (availableMonths.length > 0) {
            const latestMonth = availableMonths[0];
            const oldestMonth = availableMonths[availableMonths.length - 1];
            startMonthSelect.value = `${oldestMonth.year}-${oldestMonth.month.toString().padStart(2, '0')}`;
            endMonthSelect.value = `${latestMonth.year}-${latestMonth.month.toString().padStart(2, '0')}`;
        }
    }

    async function loadLatestThreeMonths() {
        try {
            // 載入所有法案資料
            const allBillsResponse = await fetch('/api/bills/all-range');
            if (allBillsResponse.ok) {
                allBillsData = await allBillsResponse.json();
                updateProgressStats();
                populateCategoryFilter();
            }

            // 更新當前時間範圍顯示
            if (availableMonths.length >= 3) {
                const latest3 = availableMonths.slice(0, 3);
                const rangeText = `${latest3[2].label} 至 ${latest3[0].label}`;
                currentTimeRangeDisplay.textContent = `目前顯示：${rangeText}`;
                currentTimeRange = {
                    start: `${latest3[2].year}-${latest3[2].month.toString().padStart(2, '0')}`,
                    end: `${latest3[0].year}-${latest3[0].month.toString().padStart(2, '0')}`
                };
            } else {
                currentTimeRangeDisplay.textContent = '目前顯示：所有可用資料';
                currentTimeRange = null;
            }

        } catch (error) {
            console.error('載入最新3個月資料時發生錯誤:', error);
            billContainer.innerHTML = '<p class="error-text">載入資料時發生錯誤</p>';
        }
    }

    async function applyTimeRange() {
        const startMonth = startMonthSelect.value;
        const endMonth = endMonthSelect.value;

        if (!startMonth || !endMonth) {
            alert('請選擇開始和結束月份');
            return;
        }

        if (startMonth > endMonth) {
            alert('開始月份不能晚於結束月份');
            return;
        }

        try {
            // 載入指定範圍的所有法案資料
            const allBillsResponse = await fetch(`/api/bills/all-range?start=${startMonth}&end=${endMonth}`);
            if (allBillsResponse.ok) {
                allBillsData = await allBillsResponse.json();
                updateProgressStats();
                populateCategoryFilter();
                
                // 如果有選擇進度，重新篩選
                if (currentProgressFilter) {
                    filterByProgress(currentProgressFilter);
                } else {
                    clearBillList();
                }
            }

            // 更新當前時間範圍顯示
            const startMonthObj = availableMonths.find(m => `${m.year}-${m.month.toString().padStart(2, '0')}` === startMonth);
            const endMonthObj = availableMonths.find(m => `${m.year}-${m.month.toString().padStart(2, '0')}` === endMonth);
            
            if (startMonthObj && endMonthObj) {
                currentTimeRangeDisplay.textContent = `目前顯示：${startMonthObj.label} 至 ${endMonthObj.label}`;
            } else {
                currentTimeRangeDisplay.textContent = `目前顯示：${startMonth} 至 ${endMonth}`;
            }
            
            currentTimeRange = { start: startMonth, end: endMonth };

        } catch (error) {
            console.error('套用時間範圍時發生錯誤:', error);
            alert('載入指定時間範圍的資料時發生錯誤');
        }
    }

    // --- 進度統計更新函式 ---
    function updateProgressStats() {
        const progressCounts = {
            '一讀': 0,
            '委員會審議': 0,
            '二讀': 0,
            '三讀': 0,
            '其他': 0
        };

        allBillsData.forEach(bill => {
            const progress = classifyProgress(bill.progress);
            progressCounts[progress]++;
        });

        // 更新統計數字
        Object.keys(progressCounts).forEach(progress => {
            const countElement = document.getElementById(`count-${progress}`);
            if (countElement) {
                countElement.textContent = progressCounts[progress];
            }
        });
    }

    // --- 種類篩選器填充函式 ---
    function populateCategoryFilter() {
        const categories = new Set();
        
        allBillsData.forEach(bill => {
            if (bill.categories && Array.isArray(bill.categories)) {
                bill.categories.forEach(cat => categories.add(cat));
            }
        });

        const sortedCategories = Array.from(categories).sort();
        
        categoryFilterSelect.innerHTML = '<option value="">全部種類</option>';
        sortedCategories.forEach(category => {
            const fullName = categoryDefinitions[category] || category;
            categoryFilterSelect.innerHTML += `<option value="${category}">${fullName}</option>`;
        });
    }

    // --- 篩選函式 ---
    function filterByProgress(progress) {
        currentProgressFilter = progress;
        
        // 更新進度卡片的active狀態
        progressStatCards.forEach(card => {
            if (card.dataset.progress === progress) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });

        // 篩選法案
        filteredBillsData = allBillsData.filter(bill => {
            const billProgress = classifyProgress(bill.progress);
            let progressMatch = billProgress === progress;
            
            // 如果有種類篩選，也要符合種類條件
            if (currentCategoryFilter) {
                const categoryMatch = bill.categories && bill.categories.includes(currentCategoryFilter);
                return progressMatch && categoryMatch;
            }
            
            return progressMatch;
        });

        // 更新標題和顯示
        billListTitle.textContent = `📋 ${progress} 法案列表`;
        billCountInfo.textContent = `共 ${filteredBillsData.length} 筆法案`;
        
        renderBillCards(filteredBillsData, 1);
        renderPagination(filteredBillsData.length);
    }

    function filterByCategory() {
        currentCategoryFilter = categoryFilterSelect.value;
        
        if (currentProgressFilter) {
            // 如果有選擇進度，重新篩選
            filterByProgress(currentProgressFilter);
        }
    }

    function clearFilters() {
        currentProgressFilter = '';
        currentCategoryFilter = '';
        categoryFilterSelect.value = '';
        
        // 清除進度卡片的active狀態
        progressStatCards.forEach(card => {
            card.classList.remove('active');
        });
        
        clearBillList();
    }

    function clearBillList() {
        billListTitle.textContent = '📋 請選擇一個進度';
        billCountInfo.textContent = '共 0 筆法案';
        billContainer.innerHTML = '<p class="loading-text">請點擊上方進度卡片查看法案列表</p>';
        paginationContainer.innerHTML = '';
        filteredBillsData = [];
    }

    // --- 法案卡片渲染函式 ---
    function renderBillCards(bills, page = 1, billsPerPage = 10) {
        if (!billContainer) return;
        billContainer.innerHTML = '';
        
        if (bills.length === 0) {
            billContainer.innerHTML = '<p class="loading-text">此進度下暫無法案</p>';
            return;
        }
        
        const start = (page - 1) * billsPerPage;
        const end = start + billsPerPage;
        const paginatedBills = bills.slice(start, end);

        paginatedBills.forEach((bill, index) => {
            const card = document.createElement('div');
            card.className = 'bill-card'; 
            
            const billTitle = bill.source_file.split('_').slice(2).join('_').replace('.docx', '');
            
            card.innerHTML = `
                <h4>${billTitle}</h4>
                <p class="meta">${bill.proposers.join(', ').replace(/,$/, '')}</p>
                <p class="bill-progress"><strong>進度：</strong> ${bill.progress || '未提供'}</p>
            `;

            card.addEventListener('click', () => showModal(bill));
            
            billContainer.appendChild(card);

            setTimeout(() => {
                card.classList.add('slide-in');
            }, 50 + (index * 50));
        });
    }

    function renderPagination(totalBills, billsPerPage = 10) {
        if (!paginationContainer) return;
        paginationContainer.innerHTML = '';
        if (totalBills <= billsPerPage) return;
        
        const pageCount = Math.ceil(totalBills / billsPerPage);
        for (let i = 1; i <= pageCount; i++) {
            const btn = document.createElement('button');
            btn.textContent = i;
            if (i === 1) btn.classList.add('active');
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('#pagination-container button').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                renderBillCards(filteredBillsData, i, billsPerPage);
            });
            paginationContainer.appendChild(btn);
        }
    }

    // --- AI分析手風琴功能 ---
    function createAiAnalysisAccordions(aiText) {
        if (!aiText) return '';
        const sections = [];
        const regex = /&&([^&\n]+)&&\s*([\s\S]*?)(?=&&|$)/g;

        let match;
        while ((match = regex.exec(aiText)) !== null) {
            sections.push({
                title: match[1].replace(/\(\d+\)/g, '').replace(/[&*:：]/g, '').trim(),
                content: match[2].trim()
            });
        }
        let html = '';
        const subHeadings = [
            "為什麼要改？", "改了什麼重點？", "可能會對民眾產生什麼影響？",
            "為什麼我們需要這部新法律？", "它主要在規範什麼？", "未來對民眾的生活可能有哪些影響？"
        ];
        const titlesToPrefix = ["條文差異比較", "修法理由總結", "白話文解說","立法重點摘要","增訂理由"];

        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            let displayTitle = section.title;
            if (titlesToPrefix.includes(section.title)) {
                displayTitle = "AI " + section.title;
            }
            if (section.title === "白話文解說") {
                let nestedHtml = '';
                while (i + 1 < sections.length && subHeadings.includes(sections[i + 1].title)) {
                    i++;
                    const subSection = sections[i];
                    if (subSection.content) {
                        nestedHtml += `
                            <div class="accordion-item nested">
                                <button class="accordion-header">${subSection.title}</button>
                                <div class="accordion-panel">
                                    <div class="accordion-content">
                                        <p>${convertCustomMarkdownToHTML(subSection.content)}</p>
                                    </div>
                                </div>
                            </div>`;
                    }
                }
                if (nestedHtml) {
                    html += `
                        <div class="accordion-item">
                            <button class="accordion-header">${displayTitle}</button>
                            <div class="accordion-panel">
                                <div class="accordion-content">
                                    <div class="nested-accordion-container">
                                        ${nestedHtml}
                                    </div>
                                </div>
                            </div>
                        </div>`;
                }
            } 
            else if (subHeadings.includes(section.title) || section.title === "法案分類") {
                continue;
            }
            else {
                if (section.content) {
                    html += `
                        <div class="accordion-item">
                            <button class="accordion-header">${displayTitle}</button>
                            <div class="accordion-panel">
                                <div class="accordion-content">
                                    <p>${convertCustomMarkdownToHTML(section.content)}</p>
                                </div>
                            </div>
                        </div>`;
                }
            }
        }
        return html;
    }

    function colorizeLegislatorNames(nameData) {
        if (!nameData || nameData.length === 0) return '無';
        const namesArray = nameData.flatMap(str => str.split(/\s{2,}/)).filter(Boolean);
        if (namesArray.length === 0) return '無';

        const partyClassMap = {
            '民主進步黨': 'party-dpp',
            '中國國民黨': 'party-kmt',
            '台灣民眾黨': 'party-tpp',
            '無黨籍': 'party-independent',
            'default': 'party-independent'
        };

        const coloredNames = namesArray.map(name => {
            const trimmedName = name.trim();
            if (!trimmedName) return '';
            const party = legislatorPartyMap.get(normalizeName(trimmedName)); 
            const cssClass = partyClassMap[party] || partyClassMap['default'];
            return `<span class="legislator-name ${cssClass}">${trimmedName}</span>`;
        });
        return coloredNames.join('、');
    }

    // --- Modal 相關函式 ---
    function showModal(bill) {
        if (!modalOverlay || !modalBody) return;
        
        const billTitle = bill.source_file.split('_').slice(2).join('_').replace('.docx', '');
        
        const createComparisonTableHTML = (tableData) => {
            if (!tableData || tableData.length === 0) return '<p>此為新法案或無條文對照。</p>';
            let tableHTML = '<div class="comparison-table">';
            
            tableData.forEach(item => {
                const modifiedText = item.modified_text ? item.modified_text.replace(/\n/g, '<br>') : '無';
                const currentText = item.current_text ? item.current_text.replace(/\n/g, '<br>') : '無';
                const explanation = item.explanation ? item.explanation.replace(/\n/g, '<br>') : '無';
                
                tableHTML += `
                    <div class="comparison-item"> 
                        <div class="comparison-row">
                            <div class="comparison-col"><h4>修正條文</h4><p>${modifiedText}</p></div>
                            <div class="comparison-col"><h4>現行條文</h4><p>${currentText}</p></div>
                        </div>
                        <div class="comparison-row explanation-row">
                            <div class="comparison-col explanation"><h4>說明</h4><p>${explanation}</p></div>
                        </div>
                    </div>`;
            });

            tableHTML += '</div>';
            return tableHTML;
        };
        
        modalBody.innerHTML = `
            <h2>${billTitle}</h2>
            <div class="detail-section">
                <h3>提案資訊</h3>
                <p><strong>議案編號：</strong>${bill.bill_no || '無'}</p>
                <p><strong>進度：</strong>${bill.progress || '未提供'}</p>
                <p><strong>提案人：</strong>${colorizeLegislatorNames(bill.proposers)}</p>
                <p><strong>連署人：</strong>${colorizeLegislatorNames(bill.cosigners)}</p>
            </div>
            <div class="detail-section">
                <h3>案由</h3>
                <p>${convertCustomMarkdownToHTML(bill.reason)}</p>
            </div>
            <div class="accordion-item">
                <button class="accordion-header">條文差異比較</button>
                <div class="accordion-panel">
                    <div class="accordion-content">
                        ${createComparisonTableHTML(bill.comparison_table)}
                    </div>
                </div>
            </div>
            ${createAiAnalysisAccordions(bill.ai_analysis)}
        `;
        
        // --- 手風琴功能 ---
        modalBody.querySelectorAll('.accordion-header').forEach(button => {
            button.addEventListener('click', () => {
                const panel = button.nextElementSibling;
                if (!panel || !panel.classList.contains('accordion-panel')) return;

                const onTransitionEnd = () => {
                    let parent = panel.closest('.accordion-panel');
                    while (parent) {
                        if (parent.style.maxHeight && parent.style.maxHeight !== '0px') {
                            parent.style.maxHeight = parent.scrollHeight + 'px';
                        }
                        parent = parent.parentElement.closest('.accordion-panel');
                    }
                    panel.removeEventListener('transitionend', onTransitionEnd);
                };

                panel.addEventListener('transitionend', onTransitionEnd);
                
                const isActive = button.classList.toggle('active');
                panel.style.maxHeight = isActive ? panel.scrollHeight + 'px' : null;
            });
        });
        
        modalOverlay.classList.remove('hidden');
    }

    function hideModal() {
        if (modalOverlay) {
            modalOverlay.classList.add('hidden');
        }
    }

    // --- 工具函式 ---
    function normalizeName(name) {
        if (!name) return '';
        return name.replace(/[\s‧.-]/g, '');
    }

    // --- 事件監聽器 ---
    
    // 進度卡片點擊事件
    progressStatCards.forEach(card => {
        card.addEventListener('click', () => {
            const progress = card.dataset.progress;
            filterByProgress(progress);
        });
    });

    // 時間範圍控制事件
    if (applyTimeRangeBtn) {
        applyTimeRangeBtn.addEventListener('click', applyTimeRange);
    }

    if (resetToLatestBtn) {
        resetToLatestBtn.addEventListener('click', loadLatestThreeMonths);
    }

    // 篩選控制事件
    if (categoryFilterSelect) {
        categoryFilterSelect.addEventListener('change', filterByCategory);
    }

    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', clearFilters);
    }

    // Modal 關閉事件
    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', hideModal);
    }

    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                hideModal();
            }
        });
    }

    // 鍵盤事件
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) {
            hideModal();
        }
    });

    // --- 初始化頁面 ---
    initializePage();
});

