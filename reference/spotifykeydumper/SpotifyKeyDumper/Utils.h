#pragma once

class Utils
{
public:
	static bool Detour32(char* src, char* dst, const intptr_t len);
	static char* TrampHook32(char* src, char* dst, const intptr_t len);
	static int GetSpotifyVersion();
	static std::string HexString(BYTE* data, int len);
};

