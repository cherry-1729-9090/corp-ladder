from fastapi import FastAPI
from db import db

app = FastAPI()

@app.get("/")
def root():
  return {
    "users": db.use("users").read(),
    "count": db.use("users").len()
  }

@app.post("/add")
def add():
  db.use("users").upsert({"id": 1}, {"name": "adi"})
  return {"ok": True}
