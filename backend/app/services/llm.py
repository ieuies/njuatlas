# app/services/llm.py
from openai import OpenAI
from flask import current_app
from app.logging_utils import log_event

# ==========================================
# 1. 获取 API 配置（优先用智谱，其次百炼）
# ==========================================
def _get_llm_client():
    """
    智能选择可用的 LLM 平台，返回配置好的 OpenAI 客户端。
    就像"哪个外卖平台有优惠券就用哪个"。
    """
    # API Key 统一由 app/config.py 从环境变量加载和校验。
    # 这里不直接 os.getenv()，避免配置读取逻辑散落在业务模块里。
    zhipu_key = current_app.config['ZHIPU_API_KEY']
    bailian_key = current_app.config['BAILIAN_API_KEY']
    
    if zhipu_key:
        log_event(current_app.logger, "llm_provider_selected", provider="zhipu", model="glm-4-flash")
        # 智谱 API 完全兼容 OpenAI SDK，只需改 base_url
        return OpenAI(
            api_key=zhipu_key,
            base_url="https://open.bigmodel.cn/api/paas/v4/"
        ), "glm-4-flash"  # 免费模型
    elif bailian_key:
        log_event(current_app.logger, "llm_provider_selected", provider="bailian", model="qwen-plus")
        # 阿里云百炼也兼容 OpenAI 格式
        return OpenAI(
            api_key=bailian_key,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
        ), "qwen-plus"  # 性价比高的模型
    else:
        raise RuntimeError("❌ 未配置任何大模型 API Key！请在 .env 或 Render 环境变量中设置 ZHIPU_API_KEY 或 BAILIAN_API_KEY。")

# ==========================================
# 2. 核心对话函数（所有 LLM 功能都调用它）
# ==========================================
def chat_with_llm(messages, temperature=0.7, max_tokens=500):
    """
    通用大模型对话函数——本章所有功能的"发动机"。
    
    参数:
        messages: 对话历史列表，格式 [{"role": "system/user/assistant", "content": "..."}, ...]
        temperature: 创造性参数（0=死板严谨，1=天马行空），默认0.7
        max_tokens: 回答最多多少个 token（英文≈0.75个单词，中文≈0.5个汉字），默认500
    
    返回:
        AI 回复的文本内容
    """
    client, model_name = _get_llm_client()
    
    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens
        )
    except Exception as exc:
        log_event(current_app.logger, "llm_request_failed", level="warning", model=model_name, error=str(exc))
        raise
    
    # 提取 AI 回复文字
    log_event(current_app.logger, "llm_request_succeeded", model=model_name, max_tokens=max_tokens)
    return response.choices[0].message.content
