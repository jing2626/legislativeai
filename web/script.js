// web/script.js (v6 - 支援多月份時間範圍查詢 + 完整AI分析功能)

// --- 新增：將自訂格式文字轉換為 HTML 的函式 ---
function convertCustomMarkdownToHTML(text) {
    if (!text) return '';
    let html = text;
    
    // 1. 處理 **粗體文字** -> <strong>粗體文字</strong>
    //    /g 表示全域尋找並取代所有符合的項目
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
    let fullBillListForCategory = [];
    let allBillsData = []; // 新增：儲存所有法案資料供搜尋使用
    let legislatorPartyMap = new Map();
    let availableMonths = []; // 儲存可用的月份列表
    let currentTimeRange = null; // 目前選擇的時間範圍

    const visualizationContainer = document.getElementById('visualization-container');
    const billContainer = document.getElementById('bill-container');
    const billListTitle = document.getElementById('bill-list-title');
    const paginationContainer = document.getElementById('pagination-container');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalBody = document.getElementById('modal-body');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    
    // 搜尋相關元素
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const rankingContainer = document.getElementById('ranking-container');

    // 時間範圍相關元素
    const startMonthSelect = document.getElementById('start-month');
    const endMonthSelect = document.getElementById('end-month');
    const applyTimeRangeBtn = document.getElementById('apply-time-range');
    const resetToLatestBtn = document.getElementById('reset-to-latest');
    const currentTimeRangeDisplay = document.getElementById('current-time-range');

    // --- 初始化函式 ---
    async function initializePage() {
        try {
            // 載入分類定義
            const categoriesResponse = await fetch('/api/categories');
            if (categoriesResponse.ok) {
                categoryDefinitions = await categoriesResponse.json();
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
            visualizationContainer.innerHTML = '<p class="error-text">載入頁面時發生錯誤</p>';
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
            // 使用新的API端點載入最新3個月的資料
            const summaryResponse = await fetch('/api/bills/summary-range');
            if (!summaryResponse.ok) throw new Error('無法載入統計資料');
            
            const summaryData = await summaryResponse.json();
            
            // 載入所有法案資料供搜尋使用
            const allBillsResponse = await fetch('/api/bills/all-range');
            if (allBillsResponse.ok) {
                allBillsData = await allBillsResponse.json();
            }

            // 更新顯示
            renderVisualization(summaryData, categoryDefinitions);
            renderBillRanking(generateBillRanking(allBillsData));
            
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
            visualizationContainer.innerHTML = '<p class="error-text">載入資料時發生錯誤</p>';
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
            // 載入指定範圍的統計資料
            const summaryResponse = await fetch(`/api/bills/summary-range?start=${startMonth}&end=${endMonth}`);
            if (!summaryResponse.ok) throw new Error('無法載入統計資料');
            
            const summaryData = await summaryResponse.json();
            
            // 載入指定範圍的所有法案資料
            const allBillsResponse = await fetch(`/api/bills/all-range?start=${startMonth}&end=${endMonth}`);
            if (allBillsResponse.ok) {
                allBillsData = await allBillsResponse.json();
            }

            // 更新顯示
            renderVisualization(summaryData, categoryDefinitions);
            renderBillRanking(generateBillRanking(allBillsData));
            
            // 清除當前的法案列表選擇
            clearBillList();

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

    function clearBillList() {
        billListTitle.textContent = '請選擇一個分類';
        billContainer.innerHTML = '';
        paginationContainer.innerHTML = '';
        fullBillListForCategory = [];
        
        // 清除分類選擇狀態
        document.querySelectorAll('.category-bar-wrapper.active').forEach(activeWrapper => {
            activeWrapper.classList.remove('active');
        });
    }

    // --- 搜尋功能 ---
    function performSearch(query) {
        if (!query.trim()) {
            clearSearch();
            return;
        }
        
        const searchTerm = query.toLowerCase();
        const filteredBills = allBillsData.filter(bill => {
            const billTitle = bill.source_file.split('_').slice(2).join('_').replace('.docx', '').toLowerCase();
            const proposers = bill.proposers.join(' ').toLowerCase();
            const cosigners = bill.cosigners.join(' ').toLowerCase();
            const reason = (bill.reason || '').toLowerCase();
            
            return billTitle.includes(searchTerm) || 
                   proposers.includes(searchTerm) || 
                   cosigners.includes(searchTerm) ||
                   reason.includes(searchTerm);
        });
        
        fullBillListForCategory = filteredBills;
        billListTitle.textContent = `搜尋結果：「${query}」(${filteredBills.length}筆)`;
        renderBillCards(filteredBills, 1);
        renderPagination(filteredBills.length);
        
        // 清除分類選擇狀態
        document.querySelectorAll('.category-bar-wrapper.active').forEach(activeWrapper => {
            activeWrapper.classList.remove('active');
        });
    }
    
    function clearSearch() {
        searchInput.value = '';
        clearBillList();
    }
    
    // --- 法案排名功能 ---
    function generateBillRanking(bills) {
        const billTitleCounts = {};
        
        bills.forEach(bill => {
            const title = bill.source_file.split('_').slice(2).join('_').replace('.docx', '');
            // 提取法案的主要名稱（去除修正、增訂等字樣）
            const mainTitle = title.replace(/修正|增訂|廢止|制定/g, '').trim();
            if (mainTitle) {
                billTitleCounts[mainTitle] = (billTitleCounts[mainTitle] || 0) + 1;
            }
        });
        
        // 排序並取前10名
        const sortedBills = Object.entries(billTitleCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10);
        
        return sortedBills;
    }
    
    function renderBillRanking(ranking) {
        if (!rankingContainer) return;
        
        if (ranking.length === 0) {
            rankingContainer.innerHTML = '<p class="loading-text">暫無資料</p>';
            return;
        }
        
        let html = '';
        ranking.forEach(([title, count], index) => {
            html += `
                <div class="ranking-item">
                    <div class="ranking-number">${index + 1}</div>
                    <div class="ranking-title">${title}</div>
                    <div class="ranking-count">${count}筆</div>
                </div>
            `;
        });
        
        rankingContainer.innerHTML = html;
    }

    function renderVisualization(summaryData, definitions) {
        if (!visualizationContainer) return;
        visualizationContainer.innerHTML = '';
        const chart = document.createElement('div');
        chart.className = 'category-chart';
        const values = Object.values(summaryData);
        if (values.length === 0) {
            visualizationContainer.innerHTML = `<p class="error-text">找不到此時間範圍的分類統計資料。</p>`;
            return;
        }
        const maxValue = Math.max(...values);
        const sortedCategories = Object.entries(summaryData).sort(([, a], [, b]) => b - a);
        sortedCategories.forEach(([categoryKey, count]) => {
            const fullCategoryName = definitions[categoryKey] || categoryKey;
            const barWrapper = document.createElement('div');
            barWrapper.className = 'category-bar-wrapper';
            barWrapper.title = `點擊查看 '${fullCategoryName}' 分類的 ${count} 筆法案`;
            const label = document.createElement('div');
            label.className = 'category-label';
            label.textContent = fullCategoryName;
            const bar = document.createElement('div');
            bar.className = 'category-bar';
            const barInner = document.createElement('div');
            barInner.className = 'category-bar-inner';
            barInner.style.width = `${(count / maxValue) * 100}%`;
            barInner.textContent = `${count} 筆`;
            bar.appendChild(barInner);
            barWrapper.appendChild(label);
            barWrapper.appendChild(bar);
            chart.appendChild(barWrapper);
            
            barWrapper.addEventListener('click', () => {
                document.querySelectorAll('.category-bar-wrapper.active').forEach(activeWrapper => {
                    activeWrapper.classList.remove('active');
                });
                barWrapper.classList.add('active');
                fetchAndDisplayBills(categoryKey, fullCategoryName)
            });
        });
        visualizationContainer.appendChild(chart);
    }

    function renderBillCards(bills, page = 1, billsPerPage = 10) {
        if (!billContainer) return;
        billContainer.innerHTML = '';
        const start = (page - 1) * billsPerPage;
        const end = start + billsPerPage;
        const paginatedBills = bills.slice(start, end);

        paginatedBills.forEach((bill, index) => {
            const card = document.createElement('div');
            card.className = 'bill-card'; 
            
            const billTitle = bill.source_file.split('_').slice(2).join('_').replace('.docx', '');
            
            // --- ✨ 主要修改處 ---
            // 在卡片HTML中加入顯示 bill.progress 的段落
            card.innerHTML = `
                <h4>${billTitle}</h4>
                <p class="meta">${bill.proposers.join(', ').replace(/,$/, '')}</p>
                <p class="bill-progress"><strong>進度：</strong> ${bill.progress || '未提供'}</p>
            `;
            // --- ✨ 修改結束 ---

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
                renderBillCards(fullBillListForCategory, i, billsPerPage);
            });
            paginationContainer.appendChild(btn);
        }
    }

    async function fetchAndDisplayBills(categoryKey, categoryFullName) {
        if (!billListTitle || !billContainer || !paginationContainer) return;
        billListTitle.textContent = `載入中... (${categoryFullName})`;
        billContainer.innerHTML = `<p class="loading-text">載入中...</p>`;
        paginationContainer.innerHTML = '';
        
        try {
            let billsApiUrl;
            if (currentTimeRange) {
                // 使用時間範圍API
                billsApiUrl = `/api/bills-range?start=${currentTimeRange.start}&end=${currentTimeRange.end}&category=${encodeURIComponent(categoryKey)}`;
            } else {
                // 使用預設API（最新3個月）
                billsApiUrl = `/api/bills-range?category=${encodeURIComponent(categoryKey)}`;
            }
            
            const response = await fetch(billsApiUrl);
            if (!response.ok) throw new Error('載入法案資料失敗');
            
            const bills = await response.json();
            fullBillListForCategory = bills;
            billListTitle.textContent = `${categoryFullName} (${bills.length}筆)`;
            
            if (bills.length === 0) {
                billContainer.innerHTML = `<p class="error-text">此分類在選定時間範圍內沒有法案資料。</p>`;
                return;
            }
            
            renderBillCards(bills, 1);
            renderPagination(bills.length);
        } catch (error) {
            console.error('載入法案資料時發生錯誤:', error);
            billContainer.innerHTML = `<p class="error-text">載入法案資料時發生錯誤。</p>`;
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

    function normalizeName(name) {
        if (!name) return '';
        return name.replace(/[\s‧.-]/g, '');
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

    function showModal(bill) {
        if (!modalBody || !modalOverlay) return;

        const billTitle = bill.source_file.split('_').slice(2).join('_').replace('.docx', '');

        const createComparisonTableHTML = (tableData) => {
            if (!tableData || tableData.length === 0) return '<p>此為新法案或無條文對照。</p>';
            let tableHTML = '<div class="comparison-table">';
            
            // 我們對 forEach 迴圈的內容進行修改
            tableData.forEach(item => {
                const modifiedText = item.modified_text ? item.modified_text.replace(/\n/g, '<br>') : '無';
                const currentText = item.current_text ? item.current_text.replace(/\n/g, '<br>') : '無';
                const explanation = item.explanation ? item.explanation.replace(/\n/g, '<br>') : '無';
                
                // **主要變更**：將每一組條文都用一個 .comparison-item 包起來
                tableHTML += `
                    <div class="comparison-item"> 
                        <div class="comparison-row">
                            <div class="comparison-col"><h4>修正條文</h4><p>${modifiedText}</p></div>
                            <div class="comparison-col"><h4>現行條文</h4><p>${currentText}</p></div>
                        </div>
                        <div class="comparison-row explanation-row">
                            <div class="comparison-col explanation"><h4>說明</h4><p>${explanation}</p></div>
                        </div>
                    </div>`; // 結束 .comparison-item
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

    function setupAccordion() {
        const accordionHeaders = modalBody.querySelectorAll('.accordion-header');
        accordionHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const panel = header.nextElementSibling;
                const isActive = header.classList.contains('active');
                
                // 關閉所有其他面板
                accordionHeaders.forEach(otherHeader => {
                    if (otherHeader !== header) {
                        otherHeader.classList.remove('active');
                        const otherPanel = otherHeader.nextElementSibling;
                        otherPanel.style.maxHeight = '0';
                    }
                });
                
                // 切換當前面板
                if (isActive) {
                    header.classList.remove('active');
                    panel.style.maxHeight = '0';
                } else {
                    header.classList.add('active');
                    panel.style.maxHeight = panel.scrollHeight + 'px';
                }
            });
        });
    }

    function getPartyClass(party) {
        const partyMap = {
            '民主進步黨': 'party-dpp',
            '中國國民黨': 'party-kmt', 
            '台灣民眾黨': 'party-tpp',
            '親民黨': 'party-pfp',
            '無黨籍': 'party-independent'
        };
        return partyMap[party] || 'party-independent';
    }

    // --- 事件監聽器 ---
    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', () => {
            modalOverlay.classList.add('hidden');
        });
    }

    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                modalOverlay.classList.add('hidden');
            }
        });
    }

    // 搜尋功能事件監聽器
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            performSearch(searchInput.value);
        });
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch(searchInput.value);
            }
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', clearSearch);
    }

    // 時間範圍功能事件監聽器
    if (applyTimeRangeBtn) {
        applyTimeRangeBtn.addEventListener('click', applyTimeRange);
    }

    if (resetToLatestBtn) {
        resetToLatestBtn.addEventListener('click', loadLatestThreeMonths);
    }

    // 初始化頁面
    initializePage();
});
