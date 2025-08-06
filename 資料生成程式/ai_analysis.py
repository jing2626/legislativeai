# -*- coding: utf-8 -*-
"""
AI 法案分析與內容生成器 (V2.2 - 新增重大錯誤時終止機制)

功能：
1.  啟動時自動讀取已有的分析結果，實現斷點續傳。
2.  讀取 `final_data_YYYY_MM.json` 的最終結構化資料。
3.  根據法案類型（修正案 vs. 新法案），動態生成不同的 AI 指令 (Prompt)。
4.  透過 Google Generative AI (Gemini) API 進行分析，並加入錯誤重試與指數退避機制。
5.  【新增】當 API 連續重試失敗後，將立即終止程式，且不儲存該筆失敗記錄。
6.  每成功分析一筆，就立即儲存結果，避免因中斷導致資料遺失。
7.  在每次 API 請求之間加入固定延遲，避免過於頻繁地請求。
"""
import google.generativeai as genai
import json
import os
import time
import re
import sys # <--- 新增：匯入 sys 模組以使用 exit()
from google.api_core import exceptions as google_exceptions

# --- 1. 設定您的 API 金鑰與延遲時間 ---
# 建議使用環境變數，此處為方便演示仍寫在程式碼中
# 請務必將 '【...】' 替換成您自己的金鑰
GOOGLE_API_KEY = 'AIzaSyDJetUNcazuk1AYCcgA0K5ipvJcZx6va1w' 
genai.configure(api_key=GOOGLE_API_KEY)

# --- 設定每次請求之間的延遲秒數 ---
DELAY_BETWEEN_REQUESTS = 5

# --- 分類標準化字典 (省略以求簡潔) ---
CATEGORY_MAP = {
    '食(飲食、農產)': '食', '衣(日常用品)': '衣', '住(居住)': '住', '行(交通)': '行',
    '育(教育、學校、文化、兒童少年)': '育', '樂(娛樂、旅遊)': '樂', '醫(醫療、健康、藥品)': '醫',
    '工(工作、勞務、工資)': '工', '商(商業、資本、金融)': '商', '科(科學、科技)': '科',
    '罰(刑罰、處罰)': '罰', '外(外交、國際、外國)': '外', '防(武器、國防)': '防',
    '政(權力分立)': '政', '其他(前面幾個種類都不符合，就是其他)': '其他',
    '食': '食', '衣': '衣', '住': '住', '行': '行', '育': '育', '樂': '樂', '醫': '醫',
    '工': '工', '商': '商', '科': '科', '罰': '罰', '外': '外', '防': '防', '政': '政',
    '其他': '其他'
}

# --- 2. 準備 AI 指令 (Prompt) 的模板 (省略以求簡潔) ---
CATEGORIES_TEXT = "食(飲食、農產)、衣(日常用品)、住(居住)、行(交通)、育(教育、學校、文化、兒童少年)、樂(娛樂、旅遊)、醫(醫療、健康、藥品)、工(工作、勞務、工資)、商(商業、資本、金融)、科(科學、科技)、罰(刑罰、處罰)、外(外交、國際、外國)、防(武器、國防)、政(權力分立)、其他(前面幾個種類都不符合，就是其他)"

def create_amendment_prompt(bill):
    """為「修正草案」生成專屬的 AI 指令"""
    prompt_parts = [
        "你是一位專業、中立且善於溝通的法案分析師。你的任務是幫助一般民眾，用最清晰易懂的方式理解立法草案。請根據以下提供的「法案修正對照表」與「案由」，完成四項任務，並且:(1)分析時，請勿使用表格 (2)&& &&內的文字，以及&& &&本身，代表這是我特定的標題：絕對不能更動，也絕對不能用任何方式重點標記這些文字(禁止加粗、斜體等)，必須要完整保留後再進行回答(正確範例，&&法案分類&&：你的回答)(錯誤範例，&&法案分類:你的回答)(錯誤範例，**法案分類**:你的回答)：",
        f"1. &&法案分類&&：首先，根據法案內容判斷其最相關的領域。請從以下列表中選擇 1 至 3 個最相關的分類：[{CATEGORIES_TEXT}]。請務必在獨立的一行，並只能使用 `Categories: [分類1, 分類2, ...]` 的格式回覆。",
        "2. &&條文差異比較&&：請以條列式，清晰地說明「現行條文」與「修正條文」的核心差異。",
        "3. &&修法理由總結：根據「說明」欄位的內容，用專業但精煉的語言，總結本次修法的核心目標與理由。",
        "4. &&白話文解說&&：請分別針對以下三個子項目進行白話文解說，每個子項目都必須使用提供的標題。 (1)&&為什麼要改？&& (2)&&改了什麼重點？&& (3)&&可能會對民眾產生什麼影響？&&",
        "---",
        f"**法案名稱**：{os.path.basename(bill['source_file']).replace('.docx', '')}",
        f"**案由**：{bill['reason']}",
        "---",
        "**法案修正對照表**："
    ]
    
    for item in bill["comparison_table"]:
        prompt_parts.append(f"\n【現行條文】\n{item['current_text']}\n")
        prompt_parts.append(f"【修正條文】\n{item['modified_text']}\n")
        prompt_parts.append(f"【說明】\n{item['explanation']}\n")
        
    return "\n".join(prompt_parts)

def create_new_bill_prompt(bill):
    """為「新法草案」(沒有對照表) 生成專屬的 AI 指令"""
    return "\n".join([
        "你是一位專業、中立且善於溝通的法案分析師。你的任務是幫助一般民眾，用最清晰易懂的方式理解新的立法草案。請根據以下提供的「案由」與「說明」內容，完成四項任務，並且:(1)分析時，請勿使用表格 (2)&& &&內的文字，以及&& &&本身，代表這是我特定的標題：絕對不能更動，也絕對不能用任何方式重點標記這些文字(禁止加粗、斜體等)，必須要完整保留後再進行回答(正確範例，&&法案分類&&：你的回答)(錯誤範例1，&&法案分類:你的回答)(錯誤範例2，**法案分類**:你的回答)：",
        f"1. &&法案分類&&：首先，根據法案內容判斷其最相關的領域。請從以下列表中選擇 1 至 3 個最相關的分類：[{CATEGORIES_TEXT}]。請務必在獨立的一行，並只能使用 `Categories: [分類1, 分類2, ...]` 的格式回覆。",
        "2. &&立法重點摘要&&：總結這部新法律要解決的核心問題，以及它的主要內容是什麼。",
        "3. &&增訂理由&&：用較為專業且精練的語言，說明制定這部新法律的背景與目的。",
        "4. &&白話文解說&&：請分別針對以下三個子項目進行白話文解說，每個子項目都必須使用提供的標題。 (1)&&為什麼我們需要這部新法律？&& (2)&&它主要在規範什麼？&& (3)&&未來對民眾的生活可能有哪些影響？&&",
        "---",
        f"**法案名稱**：{os.path.basename(bill['source_file']).replace('.docx', '')}",
        f"**案由與說明**：{bill['reason']}",
        "---"
    ])

# --- 3. 讀取來源檔案 (省略以求簡潔) ---
input_json_path = ''
loaded_data = None
year_int, month_int = 0, 0
while not loaded_data:
    try:
        year = input("➡️ 請輸入要處理的年份 (例如 2025): ")
        month = input("➡️ 請輸入要處理的月份 (例如 7): ")
        year_int, month_int = int(year), int(month)
        
        input_folder = r"C:\Users\weiwe\Desktop\legislative_ai_web\storage\tidy_output"
        file_name = f"final_data_{year_int}_{month_int:02d}.json"
        input_json_path = os.path.join(input_folder, file_name)

        with open(input_json_path, 'r', encoding='utf-8') as f:
            loaded_data = json.load(f)
        print(f"✅ 成功讀取來源檔案: {input_json_path}")
    except Exception as e:
        print(f"❌ 讀取檔案時發生錯誤: {e}")
        loaded_data = None # 確保錯誤後循環繼續

# --- 4. 執行 AI 分析 ---
if loaded_data:
    # --- 進度載入機制 (省略以求簡潔) ---
    output_folder = r"C:\Users\weiwe\Desktop\legislative_ai_web\storage\ai_output"
    os.makedirs(output_folder, exist_ok=True)
    output_file_name = f"ai_enriched_data_{year_int}_{month_int:02d}.json"
    output_json_path = os.path.join(output_folder, output_file_name)
    
    ai_enriched_data = []
    processed_files = set()
    
    try:
        if os.path.exists(output_json_path):
            with open(output_json_path, 'r', encoding='utf-8') as f:
                ai_enriched_data = json.load(f)
                # 建立已處理檔案的索引，方便快速查找
                for item in ai_enriched_data:
                    if 'source_file' in item:
                        processed_files.add(item['source_file'])
            print(f"✅ 成功載入 {len(processed_files)} 筆已有的分析進度。")
    except json.JSONDecodeError:
        print(f"⚠️ 警告：進度檔案 {output_json_path} 格式錯誤或為空，將重新開始。")
        ai_enriched_data = []
        processed_files = set()
    except Exception as e:
        print(f"❌ 載入進度時發生錯誤: {e}")
        # 如果載入失敗，清空列表以安全重啟
        ai_enriched_data = []
        processed_files = set()

    print("\n--- 開始進行 AI 分析，過程將自動保存進度 ---")
    
    model = genai.GenerativeModel('gemini-1.5-flash')

    for index, bill in enumerate(loaded_data):
        print("-" * 50)
        print(f"處理進度: {index + 1} / {len(loaded_data)}")
        bill_identifier = os.path.basename(bill['source_file']).replace('.docx', '')
        print(f"正在檢查: {bill_identifier[:40]}...")

        # --- 跳過已處理的檔案 ---
        if bill['source_file'] in processed_files:
            print("...此檔案先前已分析完成，自動跳過。")
            continue

        prompt = ""
        is_amendment = bill.get("comparison_table") and any(item.get("current_text", "").strip() for item in bill["comparison_table"])

        if is_amendment:
            print("...判斷為「修正案」，生成對應指令...")
            prompt = create_amendment_prompt(bill)
        else:
            print("...判斷為「新法案」，生成對應指令...")
            prompt = create_new_bill_prompt(bill)
        
        # --- API請求的重試機制 ---
        max_retries = 3
        backoff_time = 5
        ai_raw_text = None
        
        for attempt in range(max_retries):
            try:
                response = model.generate_content(prompt)
                ai_raw_text = response.text
                print("✅ AI 分析成功！")
                break
            except google_exceptions.ResourceExhausted as e:
                print(f"RATE LIMIT! API 速率超限 (嘗試 {attempt + 1}/{max_retries})。將在 {backoff_time} 秒後重試...")
                time.sleep(backoff_time)
                backoff_time *= 2
            except Exception as e:
                print(f"❌ AI 分析時發生未預期錯誤 (嘗試 {attempt + 1}/{max_retries}): {e}")
                time.sleep(backoff_time)
        
        # --- 【修改】處理 API 回應的核心邏輯 ---
        if ai_raw_text:
            # 如果成功，才處理資料、加入列表並儲存
            match = re.search(r"Categories:\s*\[([^\]]+)\]", ai_raw_text)
            raw_categories = [cat.strip() for cat in match.group(1).split(',')] if match else []
            normalized_categories = [CATEGORY_MAP.get(cat, cat) for cat in raw_categories if cat]
            
            bill['categories'] = sorted(list(set(normalized_categories)))
            bill['ai_analysis'] = ai_raw_text
            print(f"-> 標準化分類: {bill['categories']}")
            
            # 將處理完的這一筆資料加入結果列表
            ai_enriched_data.append(bill)
            
            # 每處理完一筆就存檔
            try:
                with open(output_json_path, 'w', encoding='utf-8') as f:
                    json.dump(ai_enriched_data, f, ensure_ascii=False, indent=2)
                print(f"💾 進度已即時儲存至 '{output_json_path}'")
            except Exception as e:
                print(f"❌ 儲存進度時發生嚴重錯誤: {e}")

        else:
            # 如果重試後仍然失敗，則印出嚴重錯誤訊息並終止程式
            print("\n" + "="*60)
            print(f"❌ 嚴重錯誤：API 連續請求 {max_retries} 次後依然失敗。")
            print("   原因可能為 API 金鑰錯誤、網路連線中斷或服務已達硬性限制。")
            print("   為保護現有進度，程式將立即終止。")
            print(f"   失敗前的最後進度已儲存於：{output_json_path}")
            print("   請檢查您的網路與 API 設定後再重新啟動程式。")
            print("="*60 + "\n")
            sys.exit(1) # <--- 新增：終止程式執行

        # --- 在請求之間加入延遲 ---
        if index < len(loaded_data) - 1:
            print(f"⏳ 暫停 {DELAY_BETWEEN_REQUESTS} 秒，準備處理下一筆...")
            time.sleep(DELAY_BETWEEN_REQUESTS)

    print("\n🎉 全部處理完成！最終結果已儲存。")