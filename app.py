# -*- coding: utf-8 -*-
"""
法案資料 API 伺服器 (v7 - 新增政黨提案分析功能)

功能：
1. 提供網站主頁 (index.html)。
2. 提供靜態檔案 (style.css, script.js)。
3. 提供一個 API 端點 `/api/categories` 來回傳分類定義。
4. 提供一個 API 端點 `/api/bills/summary/...` 來回傳首頁儀表板的分類統計資料。
5. 升級原有的 `/api/bills/...` 端點，使其支援依分類進行篩選。
6. 新增支援多月份時間範圍查詢的API端點。
7. 新增獲取可用月份列表的API端點。
8. 【新功能】新增政黨提案分析頁面及對應的 API。
"""
from flask import Flask, jsonify, abort, render_template, request
import json
import os
import glob
import re
from collections import Counter
from datetime import datetime

# --- 1. 路徑與 Flask App 初始化設定 ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# 前端檔案 (HTML/CSS/JS) 所在的資料夾
WEB_FOLDER_PATH = WEB_FOLDER_PATH = os.path.join(BASE_DIR, "web") 
# AI 處理後的 JSON 檔案所在的資料夾
DATA_FOLDER = DATA_FOLDER = os.path.join(BASE_DIR, "storage", "ai_output")

# 初始化 Flask，並告訴它去哪裡找樣板和靜態檔案
app = Flask(__name__, template_folder=WEB_FOLDER_PATH, static_folder=WEB_FOLDER_PATH, static_url_path='/')
# 確保回傳的 JSON 能正確顯示中文
app.config['JSON_AS_ASCII'] = False


# --- 2. 分類定義 ---

# 定義完整的分類對照表 (短格式 -> 長格式)
# 這將作為一個「字典」提供給前端
CATEGORY_DEFINITIONS = {
    '食': '食(飲食/農產)', 
    '衣': '衣(日常用品)', 
    '住': '住(居住)',
    '行': '行(交通)', 
    '育': '育(教育/文化/兒少)', 
    '樂': '樂(娛樂)',
    '醫': '醫(醫療/健康/藥品)', 
    '工': '工(工作/勞務)', 
    '商': '商(商業/金融/資本)',
    '科': '科(科學/科技)', 
    '罰': '罰(刑罰/處罰)', 
    '外': '外(外交/國際)',
    '防': '防(國防)',
    '政': '政(政府/權力分立)',
    '其他':'其他重要議題'
}


# --- 3. 輔助函式 ---

def load_bill_data(year, month):
    """一個共用的函式，用來讀取指定月份的法案資料"""
    file_name = f"ai_enriched_data_{year}_{month:02d}.json"
    file_path = os.path.join(DATA_FOLDER, file_name)
    
    if not os.path.exists(file_path):
        return None # 如果檔案不存在，回傳 None
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"讀取檔案 {file_path} 時發生錯誤: {e}")
        return None

def load_legislators_data():
    """載入立委資料"""
    file_path = os.path.join(DATA_FOLDER, "legislators.json")
    
    if not os.path.exists(file_path):
        return None
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"讀取立委資料時發生錯誤: {e}")
        return None

def get_available_months():
    """獲取資料庫中所有可用的年月份"""
    pattern = os.path.join(DATA_FOLDER, "ai_enriched_data_*.json")
    files = glob.glob(pattern)
    available_months = []
    
    for file_path in files:
        filename = os.path.basename(file_path)
        # 使用正則表達式提取年月份
        match = re.match(r'ai_enriched_data_(\d{4})_(\d{2})\.json', filename)
        if match:
            year, month = int(match.group(1)), int(match.group(2))
            available_months.append((year, month))
    
    # 按年月份排序，最新的在前
    available_months.sort(reverse=True)
    return available_months

def get_latest_months(count=3):
    """獲取最新的N個月份"""
    available_months = get_available_months()
    return available_months[:count]

def load_multiple_months_data(month_list):
    """載入多個月份的資料並合併"""
    all_bills = []
    for year, month in month_list:
        bills = load_bill_data(year, month)
        if bills:
            all_bills.extend(bills)
    return all_bills

def parse_month_range(start_month, end_month):
    """解析月份範圍字串，返回月份列表"""
    try:
        # 解析格式：2025-06
        start_year, start_month_num = map(int, start_month.split('-'))
        end_year, end_month_num = map(int, end_month.split('-'))
        
        months = []
        current_year, current_month = start_year, start_month_num
        
        while (current_year < end_year) or (current_year == end_year and current_month <= end_month_num):
            months.append((current_year, current_month))
            current_month += 1
            if current_month > 12:
                current_month = 1
                current_year += 1
        
        return months
    except Exception as e:
        print(f"解析月份範圍時發生錯誤: {e}")
        return []

def analyze_party_participation(bills, legislators_data):
    """分析法案的政黨參與情況"""
    if not legislators_data:
        return {}
    
    # 建立立委姓名到政黨的對應表
    name_to_party = {}
    for legislator in legislators_data.get('jsonList', []):
        name_to_party[legislator['name']] = legislator['party']
    
    # 統計各種政黨組合的法案數量
    party_stats = {
        '中國國民黨': [],
        '民主進步黨': [],
        '台灣民眾黨': [],
        '中國國民黨+台灣民眾黨': [],
        '中國國民黨+民主進步黨': [],
        '民主進步黨+台灣民眾黨': [],
        '無黨籍': []
    }
    
    for bill in bills:
        # 收集所有參與者（提案人+連署人）
        all_participants = bill.get('proposers', []) + bill.get('cosigners', [])
        
        # 找出參與的政黨
        participating_parties = set()
        has_independent = False
        
        for participant in all_participants:
            party = name_to_party.get(participant)
            if party:
                if party == '無黨籍':
                    has_independent = True
                elif party in ['中國國民黨', '民主進步黨', '台灣民眾黨']:
                    participating_parties.add(party)
        
        # 根據政黨組合分類
        if has_independent:
            party_stats['無黨籍'].append(bill)
        
        # 扣除無黨籍後的政黨組合
        if len(participating_parties) == 1:
            party = list(participating_parties)[0]
            party_stats[party].append(bill)
        elif len(participating_parties) == 2:
            parties = sorted(list(participating_parties))
            if parties == ['中國國民黨', '台灣民眾黨']:
                party_stats['中國國民黨+台灣民眾黨'].append(bill)
            elif parties == ['中國國民黨', '民主進步黨']:
                party_stats['中國國民黨+民主進步黨'].append(bill)
            elif parties == ['民主進步黨', '台灣民眾黨']:
                party_stats['民主進步黨+台灣民眾黨'].append(bill)
    
    return party_stats


# --- 4. 路由 (Routes) / API 端點 (Endpoints) ---

@app.route('/')
def home():
    """網站首頁"""
    return render_template('index.html')

@app.route('/progress')
def progress_page():
    """【新路由】: 提供 progress.html 進度頁面"""
    return render_template('progress.html')

@app.route('/party-analysis')
def party_analysis_page():
    """【新路由】: 提供政黨分析頁面"""
    return render_template('party-analysis.html')

@app.route('/api/categories', methods=['GET'])
def get_categories():
    """【新 API】: 提供前端分類的完整名稱字典"""
    return jsonify(CATEGORY_DEFINITIONS)

@app.route('/api/available-months', methods=['GET'])
def get_available_months_api():
    """【新 API】: 獲取資料庫中所有可用的年月份"""
    months = get_available_months()
    # 轉換為前端友好的格式
    formatted_months = [{"year": year, "month": month, "label": f"{year}年{month:02d}月"} for year, month in months]
    return jsonify(formatted_months)

@app.route('/about')
def about_page():
    """【新路由】: 提供 about.html 公開資訊頁面"""
    return render_template('about.html')

@app.route('/api/party-stats', methods=['GET'])
def get_party_stats():
    """【新 API】: 獲取政黨分析統計資料"""
    start_month = request.args.get('start')
    end_month = request.args.get('end')
    
    try:
        # 載入立委資料
        legislators_data = load_legislators_data()
        if not legislators_data:
            abort(404, description="找不到立委資料。")
        
        # 載入法案資料
        if not start_month or not end_month:
            # 使用最新3個月的資料
            latest_months = get_latest_months(3)
            if not latest_months:
                abort(404, description="找不到任何法案資料。")
            all_bills = load_multiple_months_data(latest_months)
        else:
            # 使用指定範圍的資料
            month_list = parse_month_range(start_month, end_month)
            if not month_list:
                abort(400, description="無效的月份範圍格式。")
            
            available_months = get_available_months()
            available_set = set(available_months)
            valid_months = [month for month in month_list if month in available_set]
            
            if not valid_months:
                abort(404, description="指定範圍內沒有找到任何法案資料。")
            
            all_bills = load_multiple_months_data(valid_months)
        
        # 分析政黨參與情況
        party_stats = analyze_party_participation(all_bills, legislators_data)
        
        # 計算統計數據
        total_bills = len(all_bills)
        result = {
            'total_bills': total_bills,
            'party_counts': {
                party: len(bills) for party, bills in party_stats.items()
            },
            'independent_participation_rate': len(party_stats['無黨籍']) / total_bills if total_bills > 0 else 0
        }
        
        return jsonify(result)
        
    except Exception as e:
        print(f"獲取政黨統計資料時發生錯誤: {e}")
        abort(500, description="處理政黨統計資料時發生內部錯誤。")

@app.route('/api/party-bills', methods=['GET'])
def get_party_bills():
    """【新 API】: 獲取特定政黨組合的法案列表"""
    party_type = request.args.get('party')
    start_month = request.args.get('start')
    end_month = request.args.get('end')
    
    if not party_type:
        abort(400, description="請指定政黨類型。")
    
    try:
        # 載入立委資料
        legislators_data = load_legislators_data()
        if not legislators_data:
            abort(404, description="找不到立委資料。")
        
        # 載入法案資料
        if not start_month or not end_month:
            # 使用最新3個月的資料
            latest_months = get_latest_months(3)
            if not latest_months:
                abort(404, description="找不到任何法案資料。")
            all_bills = load_multiple_months_data(latest_months)
        else:
            # 使用指定範圍的資料
            month_list = parse_month_range(start_month, end_month)
            if not month_list:
                abort(400, description="無效的月份範圍格式。")
            
            available_months = get_available_months()
            available_set = set(available_months)
            valid_months = [month for month in month_list if month in available_set]
            
            if not valid_months:
                abort(404, description="指定範圍內沒有找到任何法案資料。")
            
            all_bills = load_multiple_months_data(valid_months)
        
        # 分析政黨參與情況
        party_stats = analyze_party_participation(all_bills, legislators_data)
        
        # 回傳指定政黨的法案
        if party_type in party_stats:
            return jsonify(party_stats[party_type])
        else:
            abort(404, description="找不到指定的政黨類型。")
        
    except Exception as e:
        print(f"獲取政黨法案列表時發生錯誤: {e}")
        abort(500, description="處理政黨法案列表時發生內部錯誤。")

@app.route('/api/bills/summary/<int:year>/<int:month>', methods=['GET'])
def get_summary(year, month):
    """【原有 API】: 提供首頁儀表板需要的分類統計"""
    bills = load_bill_data(year, month)
    if bills is None:
        abort(404, description=f"找不到 {year} 年 {month} 月的法案資料。")
    
    # 使用 Counter 來快速統計所有分類的數量
    # 由於 ai_analysis.py 已經將分類標準化為短格式，這裡的計數會非常準確
    category_counts = Counter()
    for bill in bills:
        category_counts.update(bill.get('categories', []))
        
    return jsonify(dict(category_counts))

@app.route('/api/bills/summary-range', methods=['GET'])
def get_summary_range():
    """【新 API】: 提供多月份範圍的分類統計"""
    start_month = request.args.get('start')  # 格式：2025-06
    end_month = request.args.get('end')      # 格式：2025-07
    
    if not start_month or not end_month:
        # 如果沒有指定範圍，使用最新的3個月
        latest_months = get_latest_months(3)
        if not latest_months:
            abort(404, description="找不到任何法案資料。")
        all_bills = load_multiple_months_data(latest_months)
    else:
        # 解析月份範圍
        month_list = parse_month_range(start_month, end_month)
        if not month_list:
            abort(400, description="無效的月份範圍格式。")
        
        # 過濾出實際存在的月份
        available_months = get_available_months()
        available_set = set(available_months)
        valid_months = [month for month in month_list if month in available_set]
        
        if not valid_months:
            abort(404, description="指定範圍內沒有找到任何法案資料。")
        
        all_bills = load_multiple_months_data(valid_months)
    
    # 統計分類
    category_counts = Counter()
    for bill in all_bills:
        category_counts.update(bill.get('categories', []))
    
    return jsonify(dict(category_counts))

@app.route('/api/bills/<int:year>/<int:month>', methods=['GET'])
def get_bills(year, month):
    """【升級版 API】: 現在可以根據分類進行篩選"""
    bills = load_bill_data(year, month)
    if bills is None:
        abort(404, description=f"找不到 {year} 年 {month} 月的法案資料。")
    
    # 從 URL 查詢參數中獲取 'category' (例如: ...?category=工)
    category_filter = request.args.get('category')
    
    if category_filter:
        # 如果有分類篩選，只回傳包含該分類 (短格式) 的法案
        filtered_bills = [
            bill for bill in bills 
            if category_filter in bill.get('categories', [])
        ]
        return jsonify(filtered_bills)
    else:
        # 如果沒有，回傳所有法案 (維持舊有功能)
        return jsonify(bills)

@app.route('/api/bills-range', methods=['GET'])
def get_bills_range():
    """【新 API】: 獲取多月份範圍的法案資料，支援分類篩選"""
    start_month = request.args.get('start')  # 格式：2025-06
    end_month = request.args.get('end')      # 格式：2025-07
    category_filter = request.args.get('category')
    
    if not start_month or not end_month:
        # 如果沒有指定範圍，使用最新的3個月
        latest_months = get_latest_months(3)
        if not latest_months:
            abort(404, description="找不到任何法案資料。")
        all_bills = load_multiple_months_data(latest_months)
    else:
        # 解析月份範圍
        month_list = parse_month_range(start_month, end_month)
        if not month_list:
            abort(400, description="無效的月份範圍格式。")
        
        # 過濾出實際存在的月份
        available_months = get_available_months()
        available_set = set(available_months)
        valid_months = [month for month in month_list if month in available_set]
        
        if not valid_months:
            abort(404, description="指定範圍內沒有找到任何法案資料。")
        
        all_bills = load_multiple_months_data(valid_months)
    
    # 如果有分類篩選
    if category_filter:
        filtered_bills = [
            bill for bill in all_bills 
            if category_filter in bill.get('categories', [])
        ]
        return jsonify(filtered_bills)
    else:
        return jsonify(all_bills)

@app.route('/api/bills/all/<int:year>/<int:month>', methods=['GET'])
def get_all_bills(year, month):
    """【原有 API】: 提供所有法案資料供搜尋功能使用"""
    bills = load_bill_data(year, month)
    if bills is None:
        abort(404, description=f"找不到 {year} 年 {month} 月的法案資料。")
    
    return jsonify(bills)

@app.route('/api/bills/all-range', methods=['GET'])
def get_all_bills_range():
    """【新 API】: 提供多月份範圍的所有法案資料供搜尋功能使用"""
    start_month = request.args.get('start')  # 格式：2025-06
    end_month = request.args.get('end')      # 格式：2025-07
    
    if not start_month or not end_month:
        # 如果沒有指定範圍，使用最新的3個月
        latest_months = get_latest_months(3)
        if not latest_months:
            abort(404, description="找不到任何法案資料。")
        all_bills = load_multiple_months_data(latest_months)
    else:
        # 解析月份範圍
        month_list = parse_month_range(start_month, end_month)
        if not month_list:
            abort(400, description="無效的月份範圍格式。")
        
        # 過濾出實際存在的月份
        available_months = get_available_months()
        available_set = set(available_months)
        valid_months = [month for month in month_list if month in available_set]
        
        if not valid_months:
            abort(404, description="指定範圍內沒有找到任何法案資料。")
        
        all_bills = load_multiple_months_data(valid_months)
    
    return jsonify(all_bills)

@app.route('/api/legislators.json', methods=['GET'])
def get_legislators():
    """【原有 API】: 提供前端立委的完整 JSON 資料"""
    # 這裡我們直接指定 legislators.json 的完整檔案路徑
    file_name = "legislators.json"
    file_path = os.path.join(DATA_FOLDER, file_name)
    
    if not os.path.exists(file_path):
        # 如果檔案不存在，回傳 404 錯誤
        abort(404, description="找不到 legislators.json 檔案。")
    
    try:
        # 讀取檔案內容並直接回傳
        with open(file_path, 'r', encoding='utf-8') as f:
            legislator_data = json.load(f)
        return jsonify(legislator_data)
    except Exception as e:
        # 如果讀取或解析時發生錯誤，回傳 500 伺服器內部錯誤
        print(f"讀取或解析 legislators.json 時發生錯誤: {e}")
        abort(500, description="處理立委資料時發生內部錯誤。")

@app.route('/api/venn-data/<int:year>/<int:month>')
def get_venn_data(year, month):
    """
    【原有 API】: 動態組合維恩圖資料與完整的法案詳細資訊。
    """
    # --- 步驟 1: 讀取兩個必要的 JSON 檔案 ---

    # 讀取維恩圖結構檔 (只含法案編號和標題)
    venn_file_name = f"venn_data_{year}_{month:02d}.json"
    venn_file_path = os.path.join(DATA_FOLDER, venn_file_name)
    
    # 讀取法案詳細資料檔
    enriched_file_name = f"ai_enriched_data_{year}_{month:02d}.json"
    enriched_file_path = os.path.join(DATA_FOLDER, enriched_file_name)

    # 檢查檔案是否存在，若缺少任一檔案則回傳錯誤
    if not os.path.exists(venn_file_path) or not os.path.exists(enriched_file_path):
        abort(404, description=f"找不到 {year} 年 {month} 月的維恩圖或法案詳細資料檔案。")

    try:
        # --- 步驟 2: 載入資料並建立法案速查字典 ---

        # 載入維恩圖結構資料
        with open(venn_file_path, 'r', encoding='utf-8') as f:
            venn_data = json.load(f)
        
        # 載入所有法案的詳細資料
        with open(enriched_file_path, 'r', encoding='utf-8') as f:
            all_bills_details = json.load(f)

        # 建立一個以 bill_no 為 key，完整 bill 物件為 value 的字典，方便快速查找
        bill_detail_map = {bill['bill_no']: bill for bill in all_bills_details}

        # --- 步驟 3: 遍歷維恩圖資料，用完整法案物件替換簡略資訊 ---

        # 處理 venn_sets 中的每一個區域
        for area in venn_data.get('venn_sets', []):
            # 使用列表推導式快速替換
            # area['bills'] 原本是 [["編號1", "標題1"], ["編號2", "標題2"]]
            # 我們遍歷這個列表，用 bill[0] (也就是法案編號) 去速查字典
            # 如果在字典裡找得到，就將完整的法案物件放入新列表
            enriched_bills = [
                bill_detail_map.get(bill[0]) 
                for bill in area.get('bills', []) 
                if bill[0] in bill_detail_map
            ]
            # 將area中的bills更新為包含完整資訊的新列表
            area['bills'] = enriched_bills

        # 處理 non_partisan_data (無黨籍部分)
        non_partisan_data = venn_data.get('non_partisan_data')
        if non_partisan_data and 'bills' in non_partisan_data:
            enriched_bills_non_partisan = [
                bill_detail_map.get(bill[0]) 
                for bill in non_partisan_data.get('bills', [])
                if bill[0] in bill_detail_map
            ]
            non_partisan_data['bills'] = enriched_bills_non_partisan

        # --- 步驟 4: 回傳組合好的全新資料 ---
        return jsonify(venn_data)

    except Exception as e:
        print(f"處理維恩圖資料時發生錯誤: {e}")
        abort(500, description="處理維恩圖資料時發生內部錯誤。")


# --- 5. 啟動伺服器 ---

if __name__ == '__main__':
    app.run(port=5000, host='0.0.0.0')

