declare const validate: ((data: unknown) => boolean) & { errors?: { instancePath?: string; message?: string }[] | null };
export default validate;
