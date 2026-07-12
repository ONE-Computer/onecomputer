import datetime as dt

import pandas as pd
import streamlit as st

st.set_page_config(page_title="Meeting Tracker", page_icon="🗂️", layout="wide")

st.title("Meeting Tracker")
st.caption("A tiny shadow-IT style Streamlit app used to prove OneComputer governed deployment.")

with st.sidebar:
    st.header("Meeting details")
    owner = st.text_input("Owner", "Digital Transformation")
    meeting_date = st.date_input("Meeting date", dt.date.today())
    risk = st.selectbox("Data class", ["Internal", "Confidential", "Restricted"])

items = [
    {"Topic": "AI app intake", "Owner": "Terence", "Status": "Open", "Due": meeting_date.isoformat()},
    {"Topic": "CISO evidence pack", "Owner": "Cyber", "Status": "In review", "Due": meeting_date.isoformat()},
    {"Topic": "Kill-switch demo", "Owner": owner, "Status": "Planned", "Due": meeting_date.isoformat()},
]

st.subheader("Action items")
st.dataframe(pd.DataFrame(items), use_container_width=True, hide_index=True)

st.subheader("Governance note")
st.info(
    f"This app is classified as **{risk}** and should only be deployed through OneComputer with owner, IAM access, evidence, expiry, and revoke controls."
)
