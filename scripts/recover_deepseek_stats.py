import os, json, glob
from datetime import datetime

# Target directory
SIMPLIFIED_DIR = 'out_simplified'
# Time threshold: March 1, 2026, 19:13
# Note: os.path.getmtime returns epoch time.
THRESHOLD_TIME = datetime(2026, 3, 1, 19, 13).timestamp()

profiles = {
    1: [6, 8],
    2: [8, 10],
    3: [10, 12],
    4: [12, 14],
    5: [14, 100]
}

def get_target_center(lvl):
    t = profiles[lvl]
    return (t[0] + t[1]) / 2 if t[1] < 100 else 15

deepseek_results = []
files = glob.glob(os.path.join(SIMPLIFIED_DIR, '*.json'))

print(f"--- Scanning {len(files)} files in {SIMPLIFIED_DIR} ---")

count_after_time = 0
count_deepseek = 0

for f in files:
    mtime = os.path.getmtime(f)
    if mtime > THRESHOLD_TIME:
        count_after_time += 1
        try:
            with open(f, 'r', encoding='utf-8') as jf:
                data = json.load(jf)
                model = data.get('model', '').lower()
                
                # Check if it's a DeepSeek model
                if 'deepseek' in model:
                    count_deepseek += 1
                    
                    # Extract metrics
                    target_lvl = data.get('target_level', 0)
                    hit = data.get('hit_target', False)
                    rounds = data.get('rounds_used', 0)
                    
                    fidelity = data.get('fidelity', {})
                    overall_fidelity = fidelity.get('overall', 0)
                    
                    final_metrics = data.get('final_metrics', {})
                    fk = final_metrics.get('flesch_kincaid_grade', 0)
                    if fk == 0:
                        fk = data.get('metrics', {}).get('flesch_kincaid_grade', 0)
                    
                    drift = fk - get_target_center(target_lvl) if fk != 0 and target_lvl in profiles else None
                    
                    deepseek_results.append({
                        'file': os.path.basename(f),
                        'level': target_lvl,
                        'hit': hit,
                        'rounds': rounds,
                        'fidelity': overall_fidelity,
                        'fk': fk,
                        'drift': drift
                    })
        except Exception as e:
            continue

print(f"Files modified after 19:13: {count_after_time}")
print(f"DeepSeek articles found: {count_deepseek}")

if not deepseek_results:
    print("No DeepSeek data found in the specified time range.")
else:
    # Aggregate Stats
    total = len(deepseek_results)
    hits = sum(1 for r in deepseek_results if r['hit'])
    avg_rounds = sum(r['rounds'] for r in deepseek_results) / total
    avg_fidelity = sum(r['fidelity'] for r in deepseek_results) / total
    
    from collections import defaultdict
    lvl_drifts = defaultdict(list)
    for r in deepseek_results:
        if r['drift'] is not None:
            lvl_drifts[r['level']].append(r['drift'])
            
    print("\n### DeepSeek-V3.2 Comprehensive Adjustment Report (Recovered)")
    print(f"**Total Samples Processed**: {total}")
    print(f"**Target Hit Rate**: {hits/total*100:.1f}% ({hits}/{total})")
    print(f"**Average Iteration Rounds**: {avg_rounds:.2f}")
    print(f"**Average Fidelity**: {avg_fidelity:.3f}")
    
    print("\n#### Residual Drift by Level (FK Grade)")
    print("| Level | Target Range | Mean FK | Drift | Status |")
    print("| :--- | :--- | :--- | :--- | :--- |")
    for lvl in sorted(lvl_drifts.keys()):
        drifts = lvl_drifts[lvl]
        mean_drift = sum(drifts) / len(drifts)
        target = profiles[lvl]
        mean_fk = mean_drift + get_target_center(lvl)
        status = "Near Target" if abs(mean_drift) < 0.5 else ("Over" if mean_drift > 0 else "Under")
        print(f"| L{lvl} | {target[0]}-{target[1] if target[1]<100 else '+'} | {mean_fk:.2f} | {mean_drift:+.2f} | {status} |")
