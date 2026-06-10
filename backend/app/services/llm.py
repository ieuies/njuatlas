# app/services/llm.py
from openai import OpenAI
from flask import current_app
from app.logging_utils import log_event

# ==========================================
# 1. 获取 API 配置（默认优先百炼，其次智谱）
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
    llm_provider = (current_app.config.get('LLM_PROVIDER') or 'auto').lower()

    def _build_bailian_client():
        log_event(current_app.logger, "llm_provider_selected", provider="bailian", model="qwen-plus")
        # 阿里云百炼兼容 OpenAI SDK
        return OpenAI(
            api_key=bailian_key,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
        ), "qwen-plus"

    def _build_zhipu_client():
        log_event(current_app.logger, "llm_provider_selected", provider="zhipu", model="glm-4-flash")
        # 智谱 API 兼容 OpenAI SDK，只需改 base_url
        return OpenAI(
            api_key=zhipu_key,
            base_url="https://open.bigmodel.cn/api/paas/v4/"
        ), "glm-4-flash"

    # 强制指定提供方
    if llm_provider == "bailian":
        if not bailian_key:
            raise RuntimeError("LLM_PROVIDER=bailian 但未配置 BAILIAN_API_KEY。")
        return _build_bailian_client()
    if llm_provider == "zhipu":
        if not zhipu_key:
            raise RuntimeError("LLM_PROVIDER=zhipu 但未配置 ZHIPU_API_KEY。")
        return _build_zhipu_client()

    # auto 模式：默认优先阿里云百炼，其次智谱
    if bailian_key:
        return _build_bailian_client()
    if zhipu_key:
        return _build_zhipu_client()

    raise RuntimeError("❌ 未配置任何大模型 API Key！请在 .env 或 Render 环境变量中设置 BAILIAN_API_KEY 或 ZHIPU_API_KEY。")

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


def stream_chat_with_llm(messages, temperature=0.7, max_tokens=500):
    """流式对话，逐块 yield 文本片段。"""
    client, model_name = _get_llm_client()
    try:
        stream = client.chat.completions.create(
            model=model_name,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )
    except Exception as exc:
        log_event(current_app.logger, "llm_stream_failed", level="warning", model=model_name, error=str(exc))
        raise

    for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            yield delta
    log_event(current_app.logger, "llm_stream_succeeded", model=model_name, max_tokens=max_tokens)
