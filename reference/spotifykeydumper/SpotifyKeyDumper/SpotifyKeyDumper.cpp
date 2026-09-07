#include "pch.h"
#include "Hooks.h"

static const char* VERSION = "0.1";

DWORD WINAPI InitMain(LPVOID lpParam)
{
	AllocConsole();
	FILE* fDummy;
	freopen_s(&fDummy, "CONIN$", "r", stdin);
	freopen_s(&fDummy, "CONOUT$", "w", stderr);
	freopen_s(&fDummy, "CONOUT$", "w", stdout);

	std::cout << "SpotifyKeyDumper v" << VERSION << std::endl << std::endl;

	Hooks::Init();

	return 0;
}

BOOL WINAPI DllMain(HINSTANCE hModule, DWORD dwAttached, LPVOID lpvReserved)
{
	if (dwAttached == DLL_PROCESS_ATTACH)
		CreateThread(NULL, 0, &InitMain, NULL, 0, NULL);

	return 1;
}
