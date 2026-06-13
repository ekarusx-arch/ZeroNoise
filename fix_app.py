import re

with open('app.js', 'rb') as f:
    content = f.read().decode('utf-8', errors='replace')

# Find where stopFireplace() is defined the first time
pattern = r'(function stopFireplace\(\) {\n    fadeAudioOut\(audioFiles\.fire\);\n  })urce\.start\(0\);.*?function stopFireplace\(\) {.*?\n    \}, 300\);\n  }'
content = re.sub(pattern, r'\1', content, flags=re.DOTALL)

with open('app.js', 'w', encoding='utf-8') as f:
    f.write(content)
