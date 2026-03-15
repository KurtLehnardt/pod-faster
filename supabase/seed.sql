-- seed.sql
-- System voice presets using real ElevenLabs voice IDs.
-- These are available to all users via the is_system=true RLS policy.

INSERT INTO public.voice_presets (name, elevenlabs_voice_id, role, description, is_system, user_id)
VALUES
  (
    'Rachel',
    '21m00Tcm4TlvDq8ikWAM',
    'narrator',
    'Warm, clear female voice ideal for narration and storytelling.',
    true,
    NULL
  ),
  (
    'Drew',
    '29vD33N1CtxCmqQRPOHJ',
    'host',
    'Confident, engaging male voice perfect for hosting and leading discussions.',
    true,
    NULL
  ),
  (
    'Clyde',
    '2EiwWnXFnvU5JabPnv8n',
    'expert',
    'Authoritative, measured male voice suited for expert commentary and analysis.',
    true,
    NULL
  ),
  (
    'Dave',
    'CYw3kZ02Hs0563khs1Fj',
    'guest',
    'Friendly, conversational male voice great for guest segments and interviews.',
    true,
    NULL
  ),
  (
    'Domi',
    'AZnzlk1XvdvUeBnXmlld',
    'co_host',
    'Energetic, dynamic female voice ideal for co-hosting and banter.',
    true,
    NULL
  );
