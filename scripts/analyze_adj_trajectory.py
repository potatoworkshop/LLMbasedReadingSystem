import os, json, csv
from collections import defaultdict

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

csv_path = 'experiments/ch5/analysis/main_n8_2026-03-01T12-48-35_task_level_with_recovery.csv'

results = []
with open(csv_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        m = row['model']
        # Normalize deepseek names
        if 'deepseek' in m.lower():
            m = 'deepseek-v3'
        if 'grok' in m.lower():
            m = 'grok-4.1-fast'
            
        try:
            rounds = int(row.get('rounds_used')) if row.get('rounds_used') else 0
        except ValueError:
            rounds = 0
            
        try:
            fidelity = float(row.get('fidelity_overall')) if row.get('fidelity_overall') else 0.0
        except ValueError:
            fidelity = 0.0
            
        results.append({
            'model': m,
            'target_level': int(row['target_level']),
            'hit_target': row.get('hit_target') == 'True',
            'rounds': rounds,
            'fidelity': fidelity,
            'article_id': row.get('article_id')
        })

# Global stats by model
model_stats = defaultdict(lambda: {'hits': 0, 'total': 0, 'rounds': 0, 'fidelity': 0})
# model -> level -> [drift_values]
drift_matrix = defaultdict(lambda: defaultdict(list))

for res in results:
    m = res['model']
    lvl = res['target_level']
    model_stats[m]['total'] += 1
    if res['hit_target']:
        model_stats[m]['hits'] += 1
    model_stats[m]['rounds'] += res['rounds']
    model_stats[m]['fidelity'] += res['fidelity']
    
    # Check simplified article for final metrics
    a_id = res['article_id']
    if a_id:
        a_path = f'out_simplified/{a_id}.json'
        if os.path.exists(a_path):
            with open(a_path, 'r', encoding='utf-8') as af:
                ad = json.load(af)
                final_metrics = ad.get('final_metrics', {})
                final_fk = final_metrics.get('flesch_kincaid_grade', 0)
                if final_fk == 0: # Fallback if final_metrics not present
                    final_fk = ad.get('metrics', {}).get('flesch_kincaid_grade', 0)
                
                if final_fk != 0:
                    drift = final_fk - get_target_center(lvl)
                    drift_matrix[m][lvl].append(drift)

print("### 1. Adjustment Success & Efficiency (n=80 per model)")
print("| Model | Success Rate (Hit %) | Avg Rounds | Avg Fidelity |")
print("| :--- | :--- | :--- | :--- |")
for m in sorted(model_stats.keys()):
    s = model_stats[m]
    if s['total'] == 0: continue
    hrate = (s['hits']/s['total'])*100
    avg_r = s['rounds']/s['total']
    avg_f = s['fidelity']/s['total']
    print(f"| {m} | {hrate:.1f}% | {avg_r:.2f} | {avg_f:.3f} |")

print("\n### 2. Post-Adjustment Residual Drift (FK Grade)")
print("| Model | L1 Drift | L2 Drift | L3 Drift | L4 Drift | L5 Drift |")
print("| :--- | :--- | :--- | :--- | :--- | :--- |")
for m in sorted(drift_matrix.keys()):
    row = [f"**{m}**"]
    for l in range(1, 6):
        drifts = drift_matrix[m].get(l, [])
        if drifts:
            avg_drift = sum(drifts) / len(drifts)
            row.append(f"{avg_drift:+.2f}")
        else:
            row.append("-")
    print("| " + " | ".join(row) + " |")
