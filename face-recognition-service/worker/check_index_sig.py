from pymilvus import MilvusClient
import inspect
print(inspect.signature(MilvusClient.create_index))
print(MilvusClient.create_index.__doc__[:300] if MilvusClient.create_index.__doc__ else "No doc")
