# Meeting Tracker Streamlit Example

This is a deliberately small Streamlit app for the OneComputer Phase 1 wedge demo.

Local run:

```bash
pip install -r requirements.txt
streamlit run app.py
```

Governed dry run:

```bash
pnpm onecomputer:deploy examples/streamlit/meeting-tracker \
  --owner "Terence Tan" \
  --data-classification Internal \
  --users "terencetan@temasek.com.sg"
```
