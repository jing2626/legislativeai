# -*- coding: utf-8 -*-
"""
最終結構化資料萃取器 (v4.1 - 黨團姓名解析優化版)

功能：
1. 自動批次處理所有 "structured_texts_YYYY_MM.json" 檔案。
2. 【新】優化智慧人名解析邏輯，能根據上下文正確處理「黨團」提案後，以單一空格分隔的成員姓名。
3. 使用「提案編號」進行精準的進度匹配。
4. 自動從「案由」中提取「法案名稱」，並新增至最終輸出欄位。
"""
import json
import os
import re

# --- 1. 設定來源與輸出根目錄 ---
input_folder = r"C:\Users\weiwe\Desktop\legislative_ai_web\storage\docx_output" 
progress_base_folder = r"C:\Users\weiwe\Desktop\legislative_ai_web\storage\progress"
final_output_folder = r"C:\Users\weiwe\Desktop\legislative_ai_web\storage\tidy_output"

# --- 檢查路徑並建立輸出目錄 ---
if not os.path.exists(input_folder):
    print(f"❌ 錯誤：找不到來源資料夾 '{input_folder}'。")
    exit()
os.makedirs(final_output_folder, exist_ok=True)

def parse_names(text):
    if not text: return []
    # 規則1: 兩個以上的連續空格，視為不同人名的分隔。
    processed_text = re.sub(r'\s{2,}', '||', text)
    # 規則2: 四個中文字姓名後的一個空格，也視為分隔。
    processed_text = re.sub(r'([\u4e00-\u9fa5]{4})\s(?![\s])', r'\1||', processed_text)
    names = [name.strip() for name in processed_text.split('||') if name.strip()]
    return names

def load_progress_data(year_str, month_str):
    progress_map = {}
    progress_folder = os.path.join(progress_base_folder, f"{year_str}_{month_str}")
    
    if not os.path.exists(progress_folder):
        print(f"  - 資訊: 找不到對應的進度資料夾 '{progress_folder}'。")
        return progress_map

    try:
        progress_files = [f for f in os.listdir(progress_folder) if f.lower().endswith('.json')]
        for p_file in progress_files:
            p_file_path = os.path.join(progress_folder, p_file)
            with open(p_file_path, 'r', encoding='utf-8') as f:
                bills_in_file = json.load(f)
                if not isinstance(bills_in_file, list): continue
                
                for bill_data in bills_in_file:
                    proposal_no_str = bill_data.get("proposal_no")
                    progress_status = bill_data.get("progress")
                    
                    if proposal_no_str and progress_status:
                        nos = [no.strip() for no in proposal_no_str.split(';')]
                        for no in nos:
                            if no:
                                progress_map[no] = progress_status
    except Exception as e:
        print(f"  - 警告: 讀取進度檔案時發生錯誤於 '{progress_folder}': {e}")
    
    return progress_map

# --- 2. 遍歷所有 structured_texts_...json 檔案 ---
source_files = [f for f in os.listdir(input_folder) if f.startswith("structured_texts_") and f.endswith(".json")]

if not source_files:
    print(f"ℹ️  在 '{input_folder}' 中沒有找到任何檔案可供處理。")
    exit()

for json_filename in source_files:
    match = re.search(r"structured_texts_(\d{4})_(\d{2})\.json", json_filename)
    if not match: continue
    
    year_str, month_str = match.groups()
    
    print(f"\n{'='*60}")
    print(f"▶️  開始處理檔案: {json_filename}")
    
    input_json_path = os.path.join(input_folder, json_filename)
    
    try:
        with open(input_json_path, 'r', encoding='utf-8') as f:
            loaded_data = json.load(f)
    except Exception as e:
        print(f"❌ 讀取檔案 '{json_filename}' 時發生錯誤: {e}"); continue

    print("  - 正在載入立法進度資料 (以提案編號為索引)...")
    progress_map = load_progress_data(year_str, month_str)
    print(f"  - 完成載入 {len(progress_map)} 筆進度資料。")

    print("  - 開始萃取議案詳細資料...")
    final_data = []

    for filename, content in loaded_data.items():
        bill_details = { "source_file": filename, "proposal_no": None, "bill_no": None, "bill_name": None, "reason": None, "proposers": [], "cosigners": [], "progress": "進度未知", "comparison_table": [] }
        paragraphs = content.get("paragraphs", [])
        tables = content.get("tables", [])
        all_para_text = "\n".join(paragraphs)
        
        found_proposal_no = False
        for table in tables:
            for row in table:
                if len(row) > 3 and "院總第" in row[0] and "提案第" in row[2]:
                    try:
                        part1_match = re.search(r'\d+', row[0])
                        part1 = part1_match.group(0) if part1_match else ""
                        part2 = row[1][0]
                        part3 = row[3].strip()
                        
                        if part1 and part2 and part3:
                            bill_details["proposal_no"] = f"{part1}{part2}{part3}"
                            found_proposal_no = True; break
                    except (IndexError, TypeError): continue
            if found_proposal_no: break

        if bill_details["proposal_no"]:
            bill_details["progress"] = progress_map.get(bill_details["proposal_no"], "進度未知")

        if match_bill_no := re.search(r"議案編號：(\S+)", all_para_text):
            bill_details["bill_no"] = match_bill_no.group(1).strip()

        if match_reason := re.search(r"案由：([\s\S]+?)(?=提案人：|連署人：|說明：|中華民國|$)", all_para_text):
            reason_text = match_reason.group(1).strip()
            bill_details["reason"] = reason_text
            if match_bill_name := re.search(r'「(.+?)」', reason_text):
                bill_details["bill_name"] = match_bill_name.group(1).strip()
        
        # --- 【本次修正重點】新增上下文判斷邏輯 ---
        is_proposer_section = False
        is_cosigner_section = False
        is_party_caucus_proposal = False # 新增狀態旗標，用來判斷前一行是否為黨團提案

        for para in paragraphs:
            # 如果目前已經不在提案人/連署人區塊，就重設黨團旗標
            if not is_proposer_section:
                is_party_caucus_proposal = False

            if para.startswith("提案人："):
                is_proposer_section = True
                is_cosigner_section = False
                names_text = para.replace("提案人：", "").strip()
                
                # 檢查這行是不是黨團名稱
                if "黨團" in names_text:
                    is_party_caucus_proposal = True # 是黨團，立刻設定旗標！
                    bill_details["proposers"].append(names_text)
                else:
                    bill_details["proposers"].extend(parse_names(names_text))
                continue

            elif para.startswith("連署人："):
                is_cosigner_section = True
                is_proposer_section = False
                names_text = para.replace("連署人：", "").strip()
                bill_details["cosigners"].extend(parse_names(names_text))
                continue
            
            # 處理跨行的人名列表
            if (is_proposer_section or is_cosigner_section) and not re.search(r"：|號|第|條|草案", para):
                names_to_add = []
                # 如果是提案人區塊，並且上一行是黨團，就使用特別的分割模式
                if is_proposer_section and is_party_caucus_proposal:
                    # 使用單一全形空格來分割成員姓名
                    names_to_add = [name.strip() for name in para.split('　') if name.strip()]
                else:
                    # 其他所有情況，都使用原本的常規分割模式
                    names_to_add = parse_names(para)

                if is_proposer_section:
                    bill_details["proposers"].extend(names_to_add)
                elif is_cosigner_section:
                    bill_details["cosigners"].extend(names_to_add)
            else:
                is_proposer_section = False
                is_cosigner_section = False
        
        if not bill_details["proposers"]:
            for para in paragraphs:
                if match_gov := re.match(r'^([\w\s、]+)函$', para.strip()):
                    gov_names_str = match_gov.group(1).strip()
                    bill_details["proposers"] = [name for name in re.split(r'[、\s]+', gov_names_str) if name]; break
        
        # --- 表格處理邏輯 (維持不變) ---
        for table in tables:
            if not table: continue
            header_row_index = -1; headers = []; table_type = None; data_start_row = 0
            for i, row in enumerate(table):
                if not isinstance(row, list): continue
                row_text = "".join(map(str, row))
                if "修正條文" in row_text and "現行條文" in row_text and "說明" in row_text:
                    headers = [str(h).strip() for h in row]; header_row_index = i; table_type = "amendment"; data_start_row = i + 1; break
                elif ("條文" in row_text or "修正條文" in row_text) and "說明" in row_text and "現行條文" not in row_text:
                    headers = [str(h).strip() for h in row]; header_row_index = i; table_type = "new_bill"; data_start_row = i + 1; break
            if header_row_index == -1 and len(table) > 0 and isinstance(table[0], list):
                if len(table[0]) == 3: table_type = "amendment_inferred"; data_start_row = 0
                elif len(table[0]) == 2: table_type = "new_bill_inferred"; data_start_row = 0
            if table_type:
                try:
                    mod_col, cur_col, exp_col = None, None, None
                    if table_type == "amendment": mod_col, cur_col, exp_col = headers.index("修正條文"), headers.index("現行條文"), headers.index("說明")
                    elif table_type == "new_bill":
                        for idx, h_text in enumerate(headers):
                            if "條文" in h_text: mod_col = idx
                            if "說明" in h_text: exp_col = idx
                        if mod_col is None or exp_col is None: continue
                    elif table_type == "amendment_inferred": mod_col, cur_col, exp_col = 0, 1, 2
                    elif table_type == "new_bill_inferred": mod_col, exp_col = 0, 1
                    if len(table) > data_start_row:
                      for data_row in table[data_start_row:]:
                          if isinstance(data_row, list) and len(data_row) > max(filter(lambda x: x is not None, [mod_col, cur_col, exp_col]), default=-1):
                              modified_text = str(data_row[mod_col]) if mod_col is not None else ""
                              current_text = str(data_row[cur_col]) if cur_col is not None else ""
                              explanation_text = str(data_row[exp_col]) if exp_col is not None else ""
                              if modified_text.strip():
                                  bill_details["comparison_table"].append({"modified_text": modified_text, "current_text": current_text, "explanation": explanation_text})
                except (ValueError, IndexError):
                    continue
        final_data.append(bill_details)

    output_file_name = f"final_data_{year_str}_{month_str}.json"
    output_json_path = os.path.join(final_output_folder, output_file_name)
    try:
        with open(output_json_path, 'w', encoding='utf-8') as f:
            json.dump(final_data, f, ensure_ascii=False, indent=2)
        print(f"✅ 已將最終萃取的結構化資料，成功儲存至 '{output_json_path}'")
    except Exception as e:
        print(f"❌ 儲存 JSON 檔案 '{output_json_path}' 時發生錯誤: {e}")

print(f"\n{'='*60}")
print("\n🎉🎉🎉 所有檔案的資料萃取任務已全部完成！ 🎉🎉🎉")