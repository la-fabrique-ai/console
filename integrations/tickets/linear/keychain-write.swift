import Foundation
import Security

// Fixed private service; secrets enter on stdin and leave only in a requested read response.
let service = "ai.la-fabrique.console.linear-mcp"
let account = "oauth"
func fail() -> Never { FileHandle.standardError.write(Data("Keychain operation failed.\n".utf8)); exit(1) }
let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count < 2_000_000,
      let request = try? JSONSerialization.jsonObject(with: input) as? [String: Any],
      let action = request["action"] as? String else { fail() }
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service, kSecAttrAccount as String: account]
switch action {
case "read":
    var lookup = query
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?
    let status = SecItemCopyMatching(lookup as CFDictionary, &value)
    if status == errSecItemNotFound { print("null"); exit(0) }
    guard status == errSecSuccess, let data = value as? Data,
          (try? JSONSerialization.jsonObject(with: data)) != nil else { fail() }
    FileHandle.standardOutput.write(data)
case "write":
    guard let value = request["value"], JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value) else { fail() }
    let update = [kSecValueData as String: data]
    var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
    if status == errSecItemNotFound {
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        status = SecItemAdd(item as CFDictionary, nil)
    }
    guard status == errSecSuccess else { fail() }
    print("{}")
default: fail()
}
