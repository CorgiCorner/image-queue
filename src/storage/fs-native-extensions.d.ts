declare module "fs-native-extensions" {
  const native: { tryLock(fd: number): boolean };
  export default native;
}
