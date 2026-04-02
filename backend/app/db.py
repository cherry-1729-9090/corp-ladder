import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

client = MongoClient(os.getenv("MONGO_URI"))
_db = client.get_default_database()

class _Collection:
  def __init__(self, name):
    self.col = _db[name]

  def read(self, query={}):
    return list(self.col.find(query, {"_id": 0}))

  def upsert(self, query, data):
    self.col.update_one(query, {"$set": data}, upsert=True)

  def len(self, query={}):
    return self.col.count_documents(query)

class DB:
  def use(self, name):
    return _Collection(name)

db = DB()
