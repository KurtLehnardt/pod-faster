-- 00003_indexes.sql
-- Performance indexes for all tables.

-- topics: filter by user
CREATE INDEX idx_topics_user_id ON public.topics (user_id);

-- topics: filter active topics per user
CREATE INDEX idx_topics_user_id_is_active ON public.topics (user_id, is_active);

-- episodes: filter by user
CREATE INDEX idx_episodes_user_id ON public.episodes (user_id);

-- episodes: filter by user and status (pipeline monitoring)
CREATE INDEX idx_episodes_user_id_status ON public.episodes (user_id, status);

-- episodes: sort by creation date descending (feed view)
CREATE INDEX idx_episodes_created_at_desc ON public.episodes (created_at DESC);

-- voice_presets: filter by user
CREATE INDEX idx_voice_presets_user_id ON public.voice_presets (user_id);

-- voice_presets: filter system presets
CREATE INDEX idx_voice_presets_is_system ON public.voice_presets (is_system) WHERE is_system = true;

-- chat_messages: filter by user
CREATE INDEX idx_chat_messages_user_id ON public.chat_messages (user_id);

-- chat_messages: filter by episode (conversation context)
CREATE INDEX idx_chat_messages_episode_id ON public.chat_messages (episode_id);

-- chat_messages: sort by creation date descending (chat history)
CREATE INDEX idx_chat_messages_created_at_desc ON public.chat_messages (created_at DESC);
