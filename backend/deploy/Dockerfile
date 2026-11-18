FROM alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40
RUN apk add --no-cache ca-certificates tzdata openssl
WORKDIR /pb
# runtime/pocketbase must be the checksum-verified Linux binary for the target CPU.
COPY deploy/runtime/pocketbase /pb/pocketbase
COPY pb_hooks /pb/pb_hooks
COPY pb_migrations /pb/pb_migrations
RUN chmod 755 /pb/pocketbase
EXPOSE 8090
ENTRYPOINT ["/pb/pocketbase"]
CMD ["serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--hooksDir=/pb/pb_hooks", "--migrationsDir=/pb/pb_migrations", "--automigrate=false"]
