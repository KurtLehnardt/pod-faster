-- 00001_initial_schema.sql
-- Creates all tables for the pod-faster application.

-- profiles (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  default_length INTEGER DEFAULT 5,
  default_style TEXT DEFAULT 'monologue' CHECK (default_style IN ('monologue', 'interview', 'group_chat')),
  default_tone TEXT DEFAULT 'serious' CHECK (default_tone IN ('serious', 'lighthearted', 'dark_mystery', 'business_news')),
  default_voice_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.profiles IS 'User profile extending Supabase auth.users with podcast preferences.';

-- topics (user interests for podcast generation)
CREATE TABLE public.topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.topics IS 'User-defined topics that drive podcast content generation.';

-- episodes (podcast episodes with full pipeline state)
CREATE TABLE public.episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT,
  length_minutes INTEGER NOT NULL DEFAULT 5,
  style TEXT NOT NULL CHECK (style IN ('monologue', 'interview', 'group_chat')),
  tone TEXT NOT NULL CHECK (tone IN ('serious', 'lighthearted', 'dark_mystery', 'business_news')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'searching', 'summarizing', 'scripting',
    'generating_audio', 'uploading', 'completed', 'failed'
  )),
  error_message TEXT,
  topic_query TEXT NOT NULL,
  sources JSONB,
  summary TEXT,
  script JSONB,
  audio_path TEXT,
  audio_duration_seconds INTEGER,
  voice_config JSONB,
  claude_tokens_used INTEGER DEFAULT 0,
  elevenlabs_characters_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

COMMENT ON TABLE public.episodes IS 'Podcast episodes tracking the full generation pipeline from search to audio.';

-- voice_presets (system + user-defined voice configurations)
CREATE TABLE public.voice_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  elevenlabs_voice_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('narrator', 'host', 'expert', 'guest', 'co_host')),
  description TEXT,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.voice_presets IS 'ElevenLabs voice configurations. System presets have is_system=true and null user_id.';

-- chat_messages (conversation history for the AI chat interface)
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  episode_id UUID REFERENCES public.episodes(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.chat_messages IS 'Chat conversation history between users and the AI assistant.';

-- Trigger: auto-create profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (new.id, new.raw_user_meta_data->>'display_name');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Trigger: auto-update updated_at on profiles
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();
