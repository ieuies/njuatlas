# app/services/llm.py
from openai import OpenAI
from flask import current_app
from app.logging_utils import log_event

# ==========================================
# 1. 获取 API 配置（auto 优先 DeepSeek，其次百炼、智谱）
# ==========================================
def _get_llm_client():
    """
    智能选择可用的 LLM 平台，返回配置好的 OpenAI 客户端。
    """
    zhipu_key = current_app.config['ZHIPU_API_KEY']
    bailian_key = current_app.config['BAILIAN_API_KEY']
    deepseek_key = current_app.config['DEEPSEEK_API_KEY']
    deepseek_model = current_app.config.get('DEEPSEEK_MODEL') or 'deepseek-chat'
    llm_provider = (current_app.config.get('LLM_PROVIDER') or 'auto').lower()

    def _build_deepseek_client():
        log_event(
            current_app.logger,
            "llm_provider_selected",
            provider="deepseek",
            model=deepseek_model,
        )
        return OpenAI(
            api_key=deepseek_key,
            base_url="https://api.deepseek.com",
        ), deepseek_model

    def _build_bailian_client():
        log_event(current_app.logger, "llm_provider_selected", provider="bailian", model="qwen-plus")
        return OpenAI(
            api_key=bailian_key,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
        ), "qwen-plus"

    def _build_zhipu_client():
        log_event(current_app.logger, "llm_provider_selected", provider="zhipu", model="glm-4-flash")
        return OpenAI(
            api_key=zhipu_key,
            base_url="https://open.bigmodel.cn/api/paas/v4/"
        ), "glm-4-flash"

    if llm_provider == "deepseek":
        if not deepseek_key:
            raise RuntimeError("LLM_PROVIDER=deepseek 但未配置 DEEPSEEK_API_KEY。")
        return _build_deepseek_client()
    if llm_provider == "bailian":
        if not bailian_key:
            raise RuntimeError("LLM_PROVIDER=bailian 但未配置 BAILIAN_API_KEY。")
        return _build_bailian_client()
    if llm_provider == "zhipu":
        if not zhipu_key:
            raise RuntimeError("LLM_PROVIDER=zhipu 但未配置 ZHIPU_API_KEY。")
        return _build_zhipu_client()

    # auto 模式：DeepSeek → 百炼 → 智谱
    if deepseek_key:
        return _build_deepseek_client()
    if bailian_key:
        return _build_bailian_client()
    if zhipu_key:
        return _build_zhipu_client()

    raise RuntimeError(
        "未配置任何大模型 API Key！请在 .env 或 Render 环境变量中设置 "
        "DEEPSEEK_API_KEY、BAILIAN_API_KEY 或 ZHIPU_API_KEY。"
    )

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
