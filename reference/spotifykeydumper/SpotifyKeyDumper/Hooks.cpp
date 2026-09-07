#include "pch.h"
#include "Utils.h"
#include "Hooks.h"

typedef int(__cdecl* keyToLE_v25)(unsigned int* dest, int* key, int bits);
keyToLE_v25 keyToLEFunc_v25_hook = nullptr;

typedef int(__cdecl* keyToLE_v28)(unsigned int* dest, int* key, int bits, bool isEncoded);
keyToLE_v28 keyToLEFunc_v28_hook = nullptr;

std::string prevKeyStr = std::string();

int __cdecl keyToLE_hook_v25(unsigned int* dest, int* key, int bits)
{
	if (bits == 128)
	{
		BYTE keyBuffer[16];
		BYTE* keyBufPtr = keyBuffer;
		memcpy(keyBufPtr, key, 16);

		// Only print out key if it is different
		std::string newKeyStr = Utils::HexString(keyBufPtr, 16);
		if (newKeyStr.compare(prevKeyStr) != 0)
			std::cout << "Key: " << newKeyStr << std::endl << std::endl;

		prevKeyStr = newKeyStr;
	}

	return keyToLEFunc_v25_hook(dest, key, bits);
}

int __cdecl keyToLE_hook_v28(unsigned int* dest, int* key, int bits, bool isEncoded)
{
	//std::cout << "TEST" << std::endl;

	if (bits == 128)
	{
		void* decodedKeyPtr = key;

		if (isEncoded)
		{
			// key is encoded with some sort of algorithm; decode it here

			unsigned int keyDecoded[4];
			unsigned int uVar1;
			unsigned int keyPtr;
			unsigned int uVar3;
			int index;

			keyPtr = *key;
			index = 15;
			uVar3 = key[1];
			keyDecoded[0] = key[2];
			keyDecoded[1] = key[3];
			keyDecoded[2] = key[4];
			keyDecoded[3] = key[5];

			do
			{
				uVar1 = keyDecoded[index - 1 & 3];
				keyDecoded[index & 3] =
					keyDecoded[index & 3] +
					(((((uVar1 + index + keyPtr & uVar1 * 16 + uVar3) * 2 + uVar1 * -17) -
						index) - uVar3) - keyPtr);
				index = index - 1;
			}
			while (index >= 0);

			decodedKeyPtr = &keyDecoded;
		}

		// Copy key bytes to new buffer
		unsigned char keyBuffer[16];
		unsigned char* keyBufPtr = keyBuffer;
		memcpy(keyBufPtr, decodedKeyPtr, 16);

		// Only print out key if it is different
		std::string newKeyStr = Utils::HexString(keyBufPtr, 16);
		if (newKeyStr.compare(prevKeyStr) != 0)
			std::cout << "Key: " << newKeyStr << std::endl << std::endl;

		prevKeyStr = newKeyStr;
	}

	return keyToLEFunc_v28_hook(dest, key, bits, isEncoded);
}

char* GetAddrV26()
{
	BYTE ref_v19 = 0x55;
	BYTE* byteAtAddrStr = (BYTE*)0x010800C0;

	// Byte at byteAtAddr in 1.1.26-19 is 0x55
	if (*byteAtAddrStr == ref_v19)
		return (char*)0x010800C0;
	else
		return (char*)0x0107FEC0;
}

char* GetAddrV27()
{
	BYTE ref_v7 = 0x55;
	BYTE* byteAtAddrStr = (BYTE*)0x01068F90;

	// Byte at byteAtAddr in 1.1.27-7 is 0x55
	if (*byteAtAddrStr == ref_v7)
		return (char*)0x01068F90;
	else
		return (char*)0x01068F20;
}


void Hooks::Init()
{
	int spotifyVer = Utils::GetSpotifyVersion();

	// Method is stripped from Release build if this isn't here :/
	std::cout << "Spotify version: " << Utils::GetSpotifyVersion() << std::endl;

	switch (spotifyVer)
	{
	case 25:
		keyToLEFunc_v25_hook = (keyToLE_v25)Utils::TrampHook32((char*)0x0106B920, (char*)keyToLE_hook_v25, 6);
		break;
	case 26:
		// Two 1.1.26 versions
		keyToLEFunc_v25_hook = (keyToLE_v25)Utils::TrampHook32(GetAddrV26(), (char*)keyToLE_hook_v25, 6);
		break;
	case 27:
		// Two 1.1.27 versions
		keyToLEFunc_v25_hook = (keyToLE_v25)Utils::TrampHook32(GetAddrV27(), (char*)keyToLE_hook_v25, 6);
		break;
	case 28:
		keyToLEFunc_v28_hook = (keyToLE_v28)Utils::TrampHook32((char*)0x01074650, (char*)keyToLE_hook_v28, 6);
		break;
	case 29:
		keyToLEFunc_v28_hook = (keyToLE_v28)Utils::TrampHook32((char*)0x010861B0, (char*)keyToLE_hook_v28, 6);
		break;
	case 30:
		keyToLEFunc_v28_hook = (keyToLE_v28)Utils::TrampHook32((char*)0x0108E840, (char*)keyToLE_hook_v28, 6);
		break;
	case 44:
		keyToLEFunc_v28_hook = (keyToLE_v28)Utils::TrampHook32((char*)0x010CABC0, (char*)keyToLE_hook_v28, 6);
		break;
	case 45:
		keyToLEFunc_v28_hook = (keyToLE_v28)Utils::TrampHook32((char*)0x010CF780, (char*)keyToLE_hook_v28, 6);
		break;
	}
}